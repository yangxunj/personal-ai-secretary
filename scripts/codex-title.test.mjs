import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { generateCodexTitle, validateCodexTitle, TITLE_SCHEMA } from '../src/lib/codex/title.mjs';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

class Client extends EventEmitter {
  constructor(options,mode='ok'){super();this.options=options;this.mode=mode;this.calls=[];this.sent=[];}
  async connect(){}
  async request(method,params){
    this.calls.push({method,params});
    if(method==='account/read')return{account:{type:'chatgpt'}};
    if(method==='config/read')return{config:{mcp_servers:{private_mail:{}}}};
    if(method==='thread/start')return{thread:{id:'title-thread',ephemeral:this.mode!=='persistent',path:this.mode==='path'?'rollout.jsonl':null}};
    if(method==='turn/start'){
      if(this.mode!=='hang')queueMicrotask(()=>{
        this.emit('request',{id:99,method:'item/tool/call'});
        this.emit('notification',{method:'item/completed',params:{threadId:'other',item:{type:'agentMessage',text:'Wrong'}}});
        this.emit('notification',{method:'item/started',params:{threadId:'title-thread',item:{type:this.mode==='tool'?'webSearch':'userMessage'}}});
        this.emit('notification',{method:'item/completed',params:{threadId:'title-thread',item:{type:'agentMessage',text:JSON.stringify({title:'旅行预算规划'})}}});
        this.emit('notification',{method:'turn/completed',params:{threadId:'title-thread',turn:{status:'completed'}}});
      });
      return{turn:{id:'turn-title'}};
    }
    throw new Error('Unexpected method '+method);
  }
  send(message){this.sent.push(message);}
  close(){if(this.closed)return;this.closed=true;this.emit('disconnect',new Error('closed'));}
}
test('title protocol isolates ephemeral thread, disables inherited tools, bounds excerpts and validates structured output',async()=>{
  let client;
  const title=await generateCodexTitle(Array.from({length:10},(_,i)=>({role:i%2?'secretary':'user',content:'x'.repeat(5000)})),{cwd:'synthetic',clientFactory:options=>(client=new Client(options))});
  assert.equal(title,'旅行预算规划');assert.equal(client.options.webSearch,'disabled');
  const start=client.calls.find(c=>c.method==='thread/start').params,turn=client.calls.find(c=>c.method==='turn/start').params;
  assert.equal(start.ephemeral,true);assert.equal(start.approvalPolicy,'never');assert.deepEqual(start.dynamicTools,[]);assert.equal(start.config['mcp_servers.private_mail.enabled'],false);assert.equal(start.config.web_search,'disabled');
  assert.deepEqual(turn.outputSchema,TITLE_SCHEMA);const messages=JSON.parse(turn.input[0].text).messages;assert.equal(messages.length,4);assert.deepEqual(messages.map(m=>m.content.length),[1800,1200,1800,1200]);assert.equal(client.sent[0].error.code,-32601);assert.equal(client.closed,true);
});
test('title protocol refuses unconfirmed ephemeral mode before sending any excerpts and rejects tool activity',async()=>{
  for(const mode of ['persistent','path','tool']){
    let client;await assert.rejects(generateCodexTitle([{role:'user',content:'synthetic'}],{cwd:'synthetic',clientFactory:options=>(client=new Client(options,mode))}));
    if(mode!=='tool')assert.ok(!client.calls.some(c=>c.method==='turn/start'));assert.equal(client.closed,true);
  }
});
test('title protocol closes timed-out and cancelled clients and rejects malformed/sensitive title output',async()=>{
  let client;await assert.rejects(generateCodexTitle([],{timeoutMs:25,clientFactory:o=>(client=new Client(o,'hang'))}));assert.equal(client.closed,true);
  await assert.rejects(generateCodexTitle([],{signal:AbortSignal.abort(),clientFactory:o=>(client=new Client(o))}));assert.equal(client.calls.length,0);
  for(const value of [null,{title:'a'},{title:'ok',other:1},{title:'bad\nline'},{title:'账号12345678'},{title:'sk-abcdefghijk'},{title:'x'.repeat(33)}])assert.throws(()=>validateCodexTitle(value));
  assert.equal(validateCodexTitle({title:'Travel budget planning'},'en'),'Travel budget planning');
});

const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'data/codex-title-tests',Date.now().toString());await fs.mkdir(dir,{recursive:true});
process.env.DATABASE_URL='file:'+path.join(dir,'test.db').replaceAll('\\','/');process.env.UPLOAD_DIR=path.join(dir,'uploads');process.env.ENABLE_LOCAL_CODEX='true';
execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate'],{env:process.env,stdio:'pipe'});
const state=globalThis.__codexTitleTest={authorized:true,codexEnabled:true,generate:async()=> '旅行预算规划',calls:[]};
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const mocks={
  '@/lib/codex/config':data("export const localCodexEnabled=()=>globalThis.__codexTitleTest.codexEnabled;export const getCodexConfig=async()=>({executable:'synthetic',model:'synthetic-model'});"),
  '@/lib/codex/title.mjs':data('export const generateCodexTitle=async(messages,options)=>{globalThis.__codexTitleTest.calls.push({messages,options});return globalThis.__codexTitleTest.generate(messages,options);};'),
  '@/lib/pi/title':data('export const generatePiTitle=async(messages,options)=>{globalThis.__codexTitleTest.calls.push({messages,options});return globalThis.__codexTitleTest.generate(messages,options);};'),
  '@/lib/i18n/server':data("export const getLocale=async()=>'en';export const getT=async()=>s=>s;"),
  '@/lib/auth':data('export const sessionIsCurrent=async()=>globalThis.__codexTitleTest.authorized;'),
};
const hooks=registerHooks({resolve(s,c,next){if(mocks[s])return{url:mocks[s],shortCircuit:true};if(s.startsWith('@/')){const base=path.join(root,'src',s.slice(2)),f=['','.ts','.mjs','/index.ts'].map(e=>base+e).find(existsSync);return{url:pathToFileURL(f).href,shortCircuit:true};}return next(s,c);},load(url,c,next){if(url.startsWith('file:')&&url.endsWith('.ts')&&!url.includes('/node_modules/'))return{format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,c);}});
const {db}=await import('../src/lib/db.ts');
const {trackConversationTitle,queueConversationTitle,startTitleWorker,titleStatus,titleJobKey}=await import('../src/lib/conversation-titles.ts');
const {renameConversation,deleteConversation,autoTitle}=await import('../src/lib/conversations.ts');
const {GET,POST}=await import('../src/app/api/chat/title/route.ts');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn)=>{for(let i=0;i<400;i++){if(await fn())return;await sleep(10);}throw new Error('Title condition timeout');};
const completed=async(id,status='completed')=>{
  const turn=await db.codexTurn.create({data:{conversationId:id,requestKey:crypto.randomUUID(),inputHash:'synthetic',processKey:'test',status}});
  const user=await db.message.create({data:{conversationId:id,role:'user',content:'Plan travel budget'}});
  await db.message.create({data:{id:turn.id,conversationId:id,role:'secretary',content:'Compare flights and hotels'}});
  await db.codexTurn.update({where:{id:turn.id},data:{userMessageId:user.id}});return turn;
};
const idle=async()=>{if(globalThis.secretaryTitleWorker?.running)await globalThis.secretaryTitleWorker.running;};
test.after(async()=>{await idle();clearTimeout(globalThis.secretaryTitleWorker?.timer);await db.$disconnect();hooks.deregister();});

for(const backend of ['codex','pi']) {
test(backend+' automatic title needs two successful turns and preserves activity and main thread',async()=>{
  await idle();state.calls=[];state.generate=async()=> '旅行预算规划';state.codexEnabled=backend==='codex';
  const c=await db.conversation.create({data:{backend,codexThreadId:'main-thread'}});await trackConversationTitle(c.id,'en');
  await completed(c.id);await completed(c.id,'failed');await queueConversationTitle(c.id,'en');await idle();assert.equal(state.calls.length,0);assert.equal(await autoTitle(c.id,'first','reply'),null);
  await completed(c.id);const activity=new Date('2026-01-01');await db.conversation.update({where:{id:c.id},data:{updatedAt:activity}});
  await Promise.all(Array.from({length:4},()=>queueConversationTitle(c.id,'en')));await wait(async()=> (await titleStatus(c.id)).status==='auto');
  assert.equal(state.calls.length,1);assert.equal(state.calls[0].options.locale,'en');assert.equal(state.calls[0].messages.length,4);
  const saved=await db.conversation.findUnique({where:{id:c.id}});assert.equal(saved.title,'旅行预算规划');assert.equal(saved.codexThreadId,'main-thread');assert.equal(saved.updatedAt.toISOString(),activity.toISOString());
});
test(backend+' old names are untouched automatically, explicit regeneration works, same-value rename wins an active job',async()=>{
  const c=await db.conversation.create({data:{backend,title:'Original'}});await completed(c.id);await completed(c.id);const before=state.calls.length;
  await trackConversationTitle(c.id,'zh');await queueConversationTitle(c.id,'zh');await idle();assert.equal(state.calls.length,before);assert.equal((await titleStatus(c.id)).title,'Original');
  let release;state.generate=()=>new Promise(r=>{release=r;});await queueConversationTitle(c.id,'zh',true);await wait(()=>!!release);await renameConversation(c.id,'Original');release('Must not overwrite');await idle();
  assert.equal((await titleStatus(c.id)).title,'Original');assert.equal((await titleStatus(c.id)).status,'manual');
  state.generate=async()=> 'Explicit regenerated title';await queueConversationTitle(c.id,'en',true);await wait(async()=> (await titleStatus(c.id)).status==='auto');assert.equal((await titleStatus(c.id)).title,'Explicit regenerated title');
});
test(backend+' deletion cleans pending state and cannot resurrect a title; task chats are excluded',async()=>{
  const c=await db.conversation.create({data:{backend}});await completed(c.id);await completed(c.id);let release;state.generate=()=>new Promise(r=>{release=r;});await trackConversationTitle(c.id,'zh');await queueConversationTitle(c.id,'zh');await wait(()=>!!release);await deleteConversation(c.id);release('Deleted title');await idle();assert.equal(await titleStatus(c.id),null);assert.equal(await db.setting.findUnique({where:{key:titleJobKey(c.id)}}),null);
  const task=await db.task.create({data:{title:'Synthetic'}}),tc=await db.conversation.create({data:{backend,taskId:task.id}});await trackConversationTitle(tc.id,'zh');assert.equal(await db.setting.findUnique({where:{key:titleJobKey(tc.id)}}),null);await assert.rejects(queueConversationTitle(tc.id,'zh',true));
});
test(backend+' waiting/queued jobs and interrupted leases recover; failures stop after two attempts and preserve original title',async()=>{
  const c=await db.conversation.create({data:{backend}});await trackConversationTitle(c.id,'zh');await completed(c.id);await completed(c.id);state.generate=async()=> 'Recovered title';await startTitleWorker();await wait(async()=> (await titleStatus(c.id)).status==='auto');
  const legacy=await db.conversation.create({data:{backend,title:'Fallback'}});await completed(legacy.id);await completed(legacy.id);
  const row={version:1,revision:crypto.randomUUID(),status:'running',attempts:1,locale:'en',expectedTitle:'Fallback',retryAt:0,owner:'dead-process',pid:2147483640,leaseUntil:Date.now()+60000,forced:true};
  await db.setting.create({data:{key:titleJobKey(legacy.id),value:JSON.stringify(row)}});state.generate=async()=>{throw new Error('Sensitive upstream failure');};await startTitleWorker();await wait(async()=> (await titleStatus(legacy.id)).status==='failed');assert.equal((await titleStatus(legacy.id)).title,'Fallback');const stored=await db.setting.findUnique({where:{key:titleJobKey(legacy.id)}});assert.equal(JSON.parse(stored.value).attempts,2);assert.ok(!stored.value.includes('Sensitive'));await startTitleWorker();await idle();assert.equal(JSON.parse((await db.setting.findUnique({where:{key:titleJobKey(legacy.id)}})).value).attempts,2);
});
test(backend+' title endpoints authenticate, validate origin/scope and reject pending main turns',async()=>{
  const c=await db.conversation.create({data:{backend,title:'Keep'}});await completed(c.id);await completed(c.id,'running');
  const url='http://localhost/api/chat/title?conversationId='+c.id;
  state.authorized=false;assert.equal((await GET(new Request(url))).status,401);state.authorized=true;
  assert.equal((await GET(new Request('http://localhost/api/chat/title?conversationId=bad'))).status,400);
  assert.equal((await POST(new Request(url,{method:'POST',body:JSON.stringify({conversationId:c.id})}))).status,403);
  assert.equal((await POST(new Request(url,{method:'POST',headers:{Origin:'http://localhost',Host:'localhost'},body:JSON.stringify({conversationId:c.id})}))).status,409);
  const response=await GET(new Request(url));assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).title,'Keep');
  assert.equal((await titleStatus(c.id)).canRegenerate,true);
});
}
