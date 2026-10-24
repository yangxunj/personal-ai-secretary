#!/usr/bin/env node
// Real Next routes + real Pi SDK + synthetic HTTP model + isolated SQLite/files.
// Synthetic by default; --live reads only the dedicated DeepSeek configuration.
// Never reads the user's business database, uploads or credential store.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './responses-pilot.mjs';

const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'data','pi-integration',new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(dir,{recursive:true});
const databaseUrl='file:'+path.join(dir,'test.db').replaceAll('\\','/');
const live=process.argv.includes('--live')?loadConfig(root,{provider:'deepseek'}):null;
const env={...process.env,DATABASE_URL:databaseUrl,UPLOAD_DIR:path.join(dir,'uploads'),AUTH_ENABLED:'false',ALLOW_INSECURE_LOCAL:'true',SESSION_SECRET:'synthetic-secret-'.repeat(4),APP_PASSWORD_HASH:'',DESKTOP_APP:'0',ENABLE_LOCAL_CODEX:'false',APP_INSTANCE:'test',NEXT_TELEMETRY_DISABLED:'1',AI_API_KEY:'synthetic-key',AI_MODEL:'synthetic-model',SECRETARY_BUILD_DIR:'.next-pi-qa',NODE_ENV:'development'};
if(live)env.AI_MODEL=live.model;
env.SECRETARY_TSCONFIG=path.relative(root,path.join(dir,'tsconfig.json')).replaceAll('\\','/');
await fs.writeFile(path.join(root,env.SECRETARY_TSCONFIG),JSON.stringify({extends:path.join(root,'tsconfig.json'),compilerOptions:{baseUrl:root,incremental:false},include:[path.join(root,'src/**/*.ts'),path.join(root,'src/**/*.tsx')],exclude:[path.join(root,'node_modules')]}));
await fs.mkdir(env.UPLOAD_DIR,{recursive:true});
execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate'],{cwd:root,env,stdio:'pipe'});
const db=new PrismaClient({datasourceUrl:databaseUrl});
let requests=0,blockedResolve;const upstreamPayloads=[];
let usage={prompt_tokens:0,completion_tokens:0,total_tokens:0};
const upstream=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;
  const payload=JSON.parse(raw);requests++;upstreamPayloads.push(payload);
  assert.equal(req.headers.authorization,'Bearer synthetic-key');
  const user=payload.messages.findLast(m=>m.role==='user');const prompt=typeof user?.content==='string'?user.content:JSON.stringify(user?.content);
  if(prompt.includes('[qa:cancel]')){blockedResolve?.();req.on('close',()=>res.end());return;}
  if(live){
    if(requests>16){res.writeHead(429);res.end('Live test request limit');return;}
    const controller=new AbortController();res.on('close',()=>controller.abort());
    try{
      const upstream=await fetch(live.baseUrl+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+live.apiKey,'Content-Type':'application/json'},body:JSON.stringify({...payload,thinking:{type:'disabled'}}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]),redirect:'error'});
      res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('Content-Type')||'text/event-stream'});
      let pending='';const decoder=new TextDecoder();
      for await(const bytes of upstream.body){res.write(bytes);pending+=decoder.decode(bytes,{stream:true});const lines=pending.split('\n');pending=lines.pop()||'';
        for(const line of lines)if(line.startsWith('data: {')){const event=JSON.parse(line.slice(6));if(event.usage)for(const key of Object.keys(usage))usage[key]+=event.usage[key]||0;}
      }res.end();
    }catch{res.destroy();}return;
  }
  const last=payload.messages.at(-1);
  if(prompt.includes('[qa:crash]')&&last.role==='tool'){blockedResolve?.();return;}
  const send=(delta,finish_reason)=>({id:'synthetic',object:'chat.completion.chunk',model:'synthetic-model',choices:[{index:0,delta,finish_reason}]});
  let chunks;
  if(last.role==='tool'){
    let result;try{result=JSON.parse(last.content);}catch{result={error:last.content};}
    chunks=[send({role:'assistant',content:result.citation?`Source [[cite:${result.citation.token}]]`:`Saved ${result.id||'result'}`},null),send({},'stop')];
  }else if(prompt.includes('[qa:create]')||prompt.includes('[qa:crash]')){
    chunks=[send({role:'assistant',tool_calls:[{index:0,id:'create-1',type:'function',function:{name:'createTask',arguments:JSON.stringify({title:prompt.includes('[qa:crash]')?'Synthetic crash task':'Synthetic Pi task',detail:'Keep this original requirement'})}}]},null),send({},'tool_calls')];
  }else if(prompt.includes('[qa:read]')||prompt.includes('[qa:denied]')){
    const id=prompt.match(/FILE_ID=([a-z0-9]+)/)?.[1];
    chunks=[send({role:'assistant',tool_calls:[{index:0,id:'read-1',type:'function',function:{name:'readAttachment',arguments:JSON.stringify({attachmentId:id})}}]},null),send({},'tool_calls')];
  }else if(prompt.includes('[qa:output]')){
    chunks=[send({role:'assistant',tool_calls:[{index:0,id:'output-1',type:'function',function:{name:'createOutputFile',arguments:JSON.stringify({filename:'synthetic.md',content:'Synthetic generated file'})}}]},null),send({},'tool_calls')];
  }else if(prompt.includes('[qa:classify]')){
    chunks=[send({role:'assistant',tool_calls:[{index:0,id:'classify-1',type:'function',function:{name:'saveFile',arguments:JSON.stringify({category:'其他',note:'Synthetic classification'})}}]},null),send({},'tool_calls')];
  }else chunks=[send({role:'assistant',content:'Synthetic reply'},null),send({},'stop')];
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  for(const chunk of chunks)res.write('data: '+JSON.stringify(chunk)+'\n\n');
  res.end('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:300,completion_tokens:30,total_tokens:330}})+'\n\ndata: [DONE]\n\n');
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));env.AI_BASE_URL=`http://127.0.0.1:${upstream.address().port}/v1`;
await db.setting.create({data:{key:'ai.backend',value:'pi'}});
const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
let child;const log=await fs.open(path.join(dir,'next.log'),'a');
const standalone=process.argv.includes('--standalone')||process.argv.includes('--build');
if(process.argv.includes('--build'))execFileSync(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'build'],{cwd:root,env:{...env,DESKTOP_BUILD:'1',NODE_ENV:'production'},stdio:['ignore',log.fd,log.fd]});
const electron=process.argv.includes('--electron');
const standaloneRoot=path.join(root,'.next-pi-qa/standalone');
const guard=path.join(dir,'standalone-guard.cjs');
if(standalone){
  // Match the desktop prepare step: never start an artifact containing .env.
  for(const name of await fs.readdir(standaloneRoot))if(name==='.env'||name.startsWith('.env.'))await fs.unlink(path.join(standaloneRoot,name));
  await fs.cp(path.join(root,'.next-pi-qa/static'),path.join(standaloneRoot,'.next-pi-qa/static'),{recursive:true});
  await fs.cp(path.join(root,'public'),path.join(standaloneRoot,'public'),{recursive:true});
  // Prevent accidentally passing by resolving missing dependencies from the checkout.
  await fs.writeFile(guard,`const{registerHooks}=require('node:module');const{fileURLToPath}=require('node:url');const{realpathSync}=require('node:fs');const path=require('node:path');const own=${JSON.stringify(standaloneRoot)};const parent=${JSON.stringify(path.join(root,'node_modules'))};registerHooks({resolve(specifier,context,next){const r=next(specifier,context);if(r.url.startsWith('file:')){const file=realpathSync(fileURLToPath(r.url));if(file.startsWith(parent+path.sep)&&!file.startsWith(own+path.sep))throw new Error('Missing standalone dependency: '+specifier);}return r;}});`);
}
const start=()=>{
  child=spawn(electron?path.join(root,'desktop/node_modules/electron/dist/electron.exe'):process.execPath,standalone?['--require',guard,path.join(standaloneRoot,'server.js')]:[path.join(root,'node_modules/next/dist/bin/next'),'dev','-p',String(port),'-H','127.0.0.1'],{cwd:standalone?standaloneRoot:root,env:{...env,...(electron?{ELECTRON_RUN_AS_NODE:'1'}:{}),PORT:String(port),HOSTNAME:'127.0.0.1',NODE_ENV:standalone?'production':'development'},stdio:['ignore',log.fd,log.fd],windowsHide:true});
};
  const stop=async()=>{if(!child||child.exitCode!==null)return;const exited=new Promise(r=>child.once('exit',r));if(process.platform==='win32')execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'pipe',windowsHide:true});else child.kill('SIGTERM');await exited;};
const origin=`http://127.0.0.1:${port}`;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ready=async()=>{for(let n=0;n<100;n++){if(child.exitCode!==null)throw new Error('Next exited; inspect '+path.join(dir,'next.log'));try{if((await fetch(origin+'/api/agent/state')).ok)return;}catch{}await wait(500);}throw new Error('Next did not start');};
const message=(text,extra=[])=>({id:randomUUID().replaceAll('-',''),role:'user',parts:[{type:'text',text},...extra]});
const chat=async(id,msg)=>{
  const res=await fetch(origin+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({conversationId:id,message:msg})});
  const raw=await res.text();assert.equal(res.status,200,raw);return{raw,chunks:raw.split('\n').filter(x=>x.startsWith('data: {')).map(x=>JSON.parse(x.slice(6)))};
};
try{
  start();await ready();
  if(process.argv.includes('--followup')){
    const id=randomUUID().replaceAll('-',''),marker='J7X9-'+randomUUID();
    await chat(id,message('Remember this synthetic marker: '+marker+'. Reply OK only.'));
    await stop();start();await ready();
    const result=await chat(id,message('What was the exact synthetic marker? Do not call any tools.'));
    assert.ok(upstreamPayloads.at(-1).messages.some(m=>JSON.stringify(m).includes(marker)));
    const reply=result.chunks.filter(c=>c.type==='text-delta').map(c=>c.delta).join('');assert.ok(reply.includes(marker));
    const receipt={status:'passed',checks:['actual provider reply','independent Next process recovery','exact random marker recall'],standalone,electron,live:!!live,requests,usage};
    await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }else{
  const id=randomUUID().replaceAll('-',''),first=message('[qa:create] Call createTask exactly once: title="Synthetic Pi task", detail="Keep this original requirement". Then report the saved ID. This is an authorized synthetic test.');
  let result=await chat(id,first);assert.equal(result.chunks.at(-1).finishReason,'stop',result.raw);
  assert.equal(await db.task.count(),1);assert.equal((await db.conversation.findUnique({where:{id}})).backend,'pi');
  const before=requests;await chat(id,first);assert.equal(requests,before);assert.equal(await db.task.count(),1);
  console.log('PASS actual route saves task; replay makes no model calls or duplicate writes');
  const encoded='data:text/plain;base64,'+Buffer.from('Synthetic evidence J7X9').toString('base64');
  await chat(id,message('[qa:classify] Call saveFile to classify this upload as 其他. Keep the already archived attachment ID.',[{type:'file',url:encoded,mediaType:'text/plain',filename:'evidence.txt'}]));
  assert.equal(await db.attachment.count(),1);const attachment=await db.attachment.findFirst();assert.ok(attachment.messageId);
  result=await chat(id,message('[qa:read] Call readAttachment for FILE_ID='+attachment.id+' and report the evidence marker using its [[cite:token]]. Do not create tasks.'));assert.match(result.raw,/api\/files\//);assert.doesNotMatch((await db.message.findFirst({where:{conversationId:id,role:'secretary'},orderBy:{createdAt:'desc'}})).content,/\[\[cite:/);
  console.log('PASS archived upload retains one attachment ID; actual tool read produces native source links');
  await chat(id,message('[qa:output] Call createOutputFile: filename="synthetic.md", content="Synthetic generated file". Do not add any extra content.'));
  const output=await db.attachment.findFirst({where:{uploadedBy:'secretary'}});assert.ok(output?.messageId);
  assert.equal(await (await fetch(origin+'/api/files/'+output.id)).text(),'Synthetic generated file');
  console.log('PASS generated output is registered and downloadable through the real file endpoint');
  const task=await db.task.findFirst();const scoped=await db.conversation.create({data:{backend:'pi',taskId:task.id}});
  result=await chat(scoped.id,message('[qa:denied] FILE_ID='+attachment.id));
  const denied=await db.codexToolRun.findFirst({where:{turn:{conversationId:scoped.id}}});
  if(denied){assert.equal(denied.status,'failed');assert.match(denied.resultJson,/outside this conversation\/task scope/);}
  else {assert.ok(live);assert.doesNotMatch(result.chunks.filter(c=>c.type==='text-delta').map(c=>c.delta).join(''),/J7X9/);}
  console.log('PASS task chat cannot read another conversation attachment');
  const cancelId=randomUUID().replaceAll('-','');const blocked=new Promise(r=>blockedResolve=r);const pending=chat(cancelId,message('[qa:cancel] Wait'));
  await blocked;await fetch(origin+'/api/agent/state',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Host:new URL(origin).host},body:JSON.stringify({conversationId:cancelId})});
  result=await pending;assert.equal(result.chunks.at(-1).finishReason,'error');assert.equal((await db.codexTurn.findFirst({where:{conversationId:cancelId}})).status,'failed');
  console.log('PASS actual cancellation aborts upstream and preserves an explicit failed receipt');
  await stop();start();await ready();
  await chat(id,message('After restart, recall the previous synthetic task'));
  const latest=upstreamPayloads.at(-1);assert.match(JSON.stringify(latest.messages),/Synthetic Pi task/);
  assert.deepEqual((latest.tools||[]).filter(t=>['read','write','edit','bash','powershell'].includes(t.function.name)),[]);
  assert.equal(await db.task.count(),1);
  console.log('PASS new Next process resumes Pi context with no replay or shell tools');
  if(!live){
    const crashId=randomUUID().replaceAll('-',''),crashMessage=message('[qa:crash] Create a synthetic task then wait');
    const blocked=new Promise(r=>blockedResolve=r);const crashed=chat(crashId,crashMessage).catch(()=>null);
    await blocked;assert.equal(await db.task.count(),2);await stop();await crashed;
    start();await ready();
    assert.equal((await db.codexTurn.findFirst({where:{conversationId:crashId}})).status,'failed');
    const count=requests;await chat(crashId,crashMessage);assert.equal(requests,count);
    await chat(crashId,message('Only query the current result; do not repeat the previous write.'));
    assert.equal(await db.task.count(),2);
    console.log('PASS process crash after a committed tool never automatically repeats that write');
  }
  const settings=await (await fetch(origin+'/settings')).text();assert.match(settings,/value="pi"/);
  const receipt={status:'passed',standalone,electron,live:!!live,requests,usage,taskCount:await db.task.count(),attachmentCount:await db.attachment.count(),directory:dir};
  await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }
}finally{await stop();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await db.$disconnect();await log.close();}
