import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/lib/db';
import { getCodexConfig, localCodexEnabled } from '@/lib/codex/config';
import { generateCodexTitle } from '@/lib/codex/title.mjs';
import { UPLOAD_DIR } from '@/lib/storage';
import type { Prisma } from '@prisma/client';

export const titleJobKey=(id:string)=>'conversation.title.'+id;
type Job={version:1;revision:string;status:'waiting'|'queued'|'running'|'auto'|'failed'|'manual';attempts:number;locale:'zh'|'en';expectedTitle:string|null;retryAt:number;owner?:string;pid?:number;leaseUntil?:number;forced?:boolean};
const globalState=globalThis as typeof globalThis & {secretaryTitleWorker?:{owner:string;running?:Promise<void>;timer?:ReturnType<typeof setTimeout>;recovered?:Promise<void>}};
const state=globalState.secretaryTitleWorker??={owner:randomUUID()};
const parse=(raw:string):Job=>{const job=JSON.parse(raw);if(job.version!==1||!['waiting','queued','running','auto','failed','manual'].includes(job.status)||typeof job.revision!=='string'||!Number.isInteger(job.attempts)||job.attempts<0||job.attempts>2)throw new Error('Invalid title state');return job;};
const newJob=(title:string|null,locale:string):Job=>({version:1,revision:randomUUID(),status:'waiting',attempts:0,locale:locale==='en'?'en':'zh',expectedTitle:title,retryAt:0});
const alive=(pid?:number)=>{if(!pid)return false;try{process.kill(pid,0);return true;}catch{return false;}};

export async function titleStatus(id:string) {
  const [conversation,row]=await Promise.all([db.conversation.findUnique({where:{id},select:{title:true,backend:true,taskId:true}}),db.setting.findUnique({where:{key:titleJobKey(id)}})]);
  if(!conversation)return null;
  let status:Job['status']='waiting';
  if(row)try{status=parse(row.value).status;}catch{status='failed';}
  return {title:conversation.title,status,canRegenerate:conversation.backend==='codex'&&!conversation.taskId&&localCodexEnabled()};
}

/** Call inside the same transaction as a manual rename, including same-value renames. */
export async function protectManualTitle(tx:Prisma.TransactionClient,id:string) {
  const c=await tx.conversation.findUnique({where:{id},select:{backend:true,title:true}});
  if(c?.backend!=='codex')return;
  const value=JSON.stringify({...newJob(c.title,'zh'),status:'manual'});
  await tx.setting.upsert({where:{key:titleJobKey(id)},create:{key:titleJobKey(id),value},update:{value}});
}

/** Persist registration before starting the first turn; never auto-replace an existing title. */
export async function trackCodexTitle(id:string,locale:string) {
  const c=await db.conversation.findUnique({where:{id},select:{title:true,taskId:true,backend:true}});
  if(!c||c.backend!=='codex'||c.taskId||c.title!==null)return;
  await db.setting.upsert({where:{key:titleJobKey(id)},create:{key:titleJobKey(id),value:JSON.stringify(newJob(null,locale))},update:{}});
}

export async function queueCodexTitle(id:string,locale:string,force=false) {
  await db.$transaction(async tx=>{
    const c=await tx.conversation.findUnique({where:{id},select:{title:true,taskId:true,backend:true}});
    if(!c||c.backend!=='codex'||c.taskId)throw new Error('Title generation is only available for Codex conversations');
    const row=await tx.setting.findUnique({where:{key:titleJobKey(id)}}),old=row?parse(row.value):null;
    if(old&&['queued','running'].includes(old.status))return;
    if(!force&&(c.title!==null||old&&old.status!=='waiting'))return;
    if(force&&await tx.codexTurn.findFirst({where:{conversationId:id,status:{in:['queued','running']}}}))throw new Error('Wait for the conversation to finish');
    const completed=await tx.codexTurn.count({where:{conversationId:id,status:'completed'}});
    if(!force&&completed<2)return;
    const job={...newJob(c.title,locale),status:'queued',forced:force} satisfies Job;
    const value=JSON.stringify(job);
    await tx.setting.upsert({where:{key:titleJobKey(id)},create:{key:titleJobKey(id),value},update:{value}});
  });
  wakeTitleWorker();
  return titleStatus(id);
}

async function excerpts(id:string,forced:boolean) {
  const turns=await db.codexTurn.findMany({where:{conversationId:id,status:'completed'},orderBy:[{createdAt:'asc'},{id:'asc'}],take:2,select:{id:true,userMessageId:true}});
  const ids=turns.flatMap(t=>[t.userMessageId,t.id]).filter((s):s is string=>!!s);
  const rows=await db.message.findMany({where:{conversationId:id,...(ids.length?{id:{in:ids}}:{}),role:{in:['user','secretary']},NOT:{content:''}},orderBy:[{createdAt:'asc'},{id:'asc'}],take:4,select:{id:true,role:true,content:true}});
  const ordered=ids.length?ids.map(id=>rows.find(m=>m.id===id)).filter((m):m is NonNullable<typeof m>=>!!m):rows;
  if((!forced&&turns.length<2)||!ordered.some(m=>m.role==='user')||!ordered.some(m=>m.role==='secretary'))throw new Error('No completed conversation excerpts');
  return ordered.map(m=>({role:m.role,content:m.content.slice(0,m.role==='user'?1800:1200)}));
}

async function processJob(key:string,raw:string,job:Job) {
  const id=key.slice('conversation.title.'.length);
  if(job.status!=='queued'||job.retryAt>Date.now())return;
  if(await db.codexTurn.findFirst({where:{conversationId:id,status:{in:['queued','running']}}}))return;
  const c=await db.conversation.findUnique({where:{id},select:{title:true,backend:true,taskId:true}});
  if(!c){await db.setting.deleteMany({where:{key,value:raw}});return;}
  if(c.backend!=='codex'||c.taskId||c.title!==job.expectedTitle){await db.setting.updateMany({where:{key,value:raw},data:{value:JSON.stringify({...job,status:'manual'})}});return;}
  const claimed={...job,status:'running',attempts:job.attempts+1,owner:state.owner,pid:process.pid,leaseUntil:Date.now()+60000} satisfies Job;
  const running=JSON.stringify(claimed);
  if(!(await db.setting.updateMany({where:{key,value:raw},data:{value:running}})).count)return;
  try{
    const messages=await excerpts(id,!!job.forced),cfg=await getCodexConfig(),cwd=path.resolve(UPLOAD_DIR,'../title-runtime');
    await mkdir(cwd,{recursive:true});
    const title=await generateCodexTitle(messages,{executable:cfg.executable,cwd,model:cfg.model,locale:job.locale});
    await db.$transaction(async tx=>{
      const current=await tx.setting.findUnique({where:{key}});
      if(current?.value!==running)return;
      // Parameterized SQL updates only title; preserves the newest activity time.
      const count=job.expectedTitle===null
        ?await tx.$executeRaw`UPDATE "Conversation" SET "title"=${title} WHERE "id"=${id} AND "title" IS NULL`
        :await tx.$executeRaw`UPDATE "Conversation" SET "title"=${title} WHERE "id"=${id} AND "title"=${job.expectedTitle}`;
      await tx.setting.updateMany({where:{key,value:running},data:{value:JSON.stringify({...claimed,status:count?'auto':'manual'})}});
    });
  }catch{
    const next={...claimed,status:claimed.attempts<2?'queued':'failed',retryAt:Date.now()+30000};
    await db.setting.updateMany({where:{key,value:running},data:{value:JSON.stringify(next)}});
  }
}

function wakeTitleWorker() {
  if(!localCodexEnabled()||process.env.NEXT_PHASE==='phase-production-build'||state.running)return;
  clearTimeout(state.timer);
  state.running=(async()=>{
    const rows=await db.setting.findMany({where:{key:{startsWith:'conversation.title.'}},orderBy:{key:'asc'}});
    for(const row of rows){let job:Job;try{job=parse(row.value);}catch{continue;}await processJob(row.key,row.value,job);}
  })().catch(()=>console.warn('[chat] Title worker unavailable')).finally(()=>{
    state.running=undefined;
    // No permanent poll when the queue is empty. Waiting first rounds are idle.
    void db.setting.findMany({where:{key:{startsWith:'conversation.title.'}},select:{value:true}}).then(rows=>{
      const pending=rows.some(r=>{try{return ['queued','running'].includes(parse(r.value).status);}catch{return false;}});
      if(pending){state.timer=setTimeout(()=>void startTitleWorker(),2000);state.timer.unref?.();}
    }).catch(()=>{});
  });
}

export async function startTitleWorker() {
  if(!localCodexEnabled()||process.env.NEXT_PHASE==='phase-production-build')return;
  const rows=await db.setting.findMany({where:{key:{startsWith:'conversation.title.'}}});
  for(const row of rows){
    let job:Job;try{job=parse(row.value);}catch{continue;}
    const id=row.key.slice('conversation.title.'.length);
    if(job.status==='waiting'){await queueCodexTitle(id,job.locale).catch(()=>{});continue;}
    if(job.status==='running'&&job.owner!==state.owner&&(!alive(job.pid)||(job.leaseUntil??0)<Date.now())){
      await db.setting.updateMany({where:{key:row.key,value:row.value},data:{value:JSON.stringify({...job,status:job.attempts<2?'queued':'failed',retryAt:0})}});
    }
  }
  wakeTitleWorker();
}
