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
import { runRecordScenarios } from './agent-records-cases.mjs';
import { runMediaScenarios } from './agent-media-cases.mjs';

const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'data','pi-integration',new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(dir,{recursive:true});
const databaseUrl='file:'+path.join(dir,'test.db').replaceAll('\\','/');
const liveWeb=process.argv.includes('--live-web');
const live=process.argv.includes('--live')||liveWeb?loadConfig(root,{provider:'deepseek'}):null;
const webSearch=process.argv.includes('--web-search');
const records=process.argv.includes('--records');
const media=process.argv.includes('--media');
if(webSearch&&live)throw new Error('Use separate synthetic web and live provider runs');
const env={...process.env,DATABASE_URL:databaseUrl,UPLOAD_DIR:path.join(dir,'uploads'),AUTH_ENABLED:'false',ALLOW_INSECURE_LOCAL:'true',SESSION_SECRET:'synthetic-secret-'.repeat(4),APP_PASSWORD_HASH:'',DESKTOP_APP:'0',ENABLE_LOCAL_CODEX:'false',APP_INSTANCE:'test',NEXT_TELEMETRY_DISABLED:'1',AI_API_KEY:'synthetic-key',AI_MODEL:'synthetic-model',SECRETARY_BUILD_DIR:'.next-pi-qa',NODE_ENV:'development'};
if(live)env.AI_MODEL=live.model;
if(liveWeb)env.DEEPSEEK_SEARCH_API_KEY=live.apiKey;
env.SECRETARY_TSCONFIG=path.relative(root,path.join(dir,'tsconfig.json')).replaceAll('\\','/');
await fs.writeFile(path.join(root,env.SECRETARY_TSCONFIG),JSON.stringify({extends:path.join(root,'tsconfig.json'),compilerOptions:{baseUrl:root,incremental:false},include:[path.join(root,'src/**/*.ts'),path.join(root,'src/**/*.tsx')],exclude:[path.join(root,'node_modules')]}));
await fs.mkdir(env.UPLOAD_DIR,{recursive:true});
execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate'],{cwd:root,env,stdio:'pipe'});
const db=new PrismaClient({datasourceUrl:databaseUrl});
if(webSearch){
  const fixture=path.join(dir,'web-fixture.cjs');
  // Test-only network interception. Production client retains its fixed official URL.
  await fs.writeFile(fixture,`const original=globalThis.fetch;globalThis.fetch=async(input,init)=>{const url=String(input);if(url.startsWith('https://api.deepseek.com/v1/tools/')){if(init.headers.authorization!=='Bearer synthetic-search-key')throw new Error('Unexpected fixture key');const body=JSON.parse(init.body);if(url.endsWith('/search'))return Response.json({results:[{title:'Synthetic web source',url:'https://example.com/public',snippet:'Synthetic public summary',summary:'Public fixture J7X9'}]});if(url.endsWith('/fetch')&&body.url==='https://example.com/public')return Response.json({title:'Synthetic web source',content:'Synthetic original public page J7X9'});throw new Error('Unexpected fixture request');}return original(input,init);};`);
  env.NODE_OPTIONS=(env.NODE_OPTIONS||'')+' --require "'+fixture.replaceAll('\\','/')+'"';
}
let requests=0,blockedResolve;const upstreamPayloads=[];
let usage={prompt_tokens:0,completion_tokens:0,total_tokens:0};
const upstream=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;
  const payload=JSON.parse(raw);requests++;upstreamPayloads.push(payload);
  assert.equal(req.headers.authorization,'Bearer synthetic-key');
  const user=payload.messages.findLast(m=>m.role==='user');const prompt=typeof user?.content==='string'?user.content:JSON.stringify(user?.content);
  const mediaUser=media?payload.messages.findLast(m=>m.role==='user'&&JSON.stringify(m.content).includes('[qa:media]')):null;
  if(prompt.includes('[qa:search-off]'))assert.ok(!(payload.tools||[]).some(t=>['webSearch','fetchWebPage'].includes(t.function.name)));
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
  if(mediaUser){
    const text=typeof mediaUser.content==='string'?mediaUser.content:JSON.stringify(mediaUser.content),kind=text.match(/KIND=(\w+)/)[1],id=text.match(/FILE_ID=(\w+)/)[1];
    const current=payload.messages.slice(payload.messages.lastIndexOf(mediaUser)+1).filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
    const parts=['word/document.xml','word/comments.xml','word/header1.xml','word/footnotes.xml'];
    let name,args;
    if(kind==='docx'&&current.length<5){name=current.length===0?'inspectAttachment':'readDocumentPart';args={attachmentId:id,...(current.length?{partId:parts[current.length-1],expectedVersion:current[0].version}:{})};}
    else if(!current.some(r=>r.image)){name='readAttachmentVisual';args={attachmentId:id,...(kind==='pdf'?{page:8,crop:{x:0.3,y:0.25,width:0.65,height:0.3}}:kind==='docx'?{imageId:'word/media/image1.png',expectedVersion:current[0].version}:{})};}
    if(name)chunks=[send({role:'assistant',tool_calls:[{index:0,id:'media-'+current.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null),send({},'tool_calls')];
    else{
      assert.ok(payload.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url'&&c.image_url.url.startsWith('data:image/png;base64,'))),'Pi did not send an actual image block');
      const result=current.find(r=>r.image);assert.ok(result.ok);assert.equal(result.image.data,undefined);
      chunks=[send({role:'assistant',content:'Synthetic native-image transport verified [[cite:'+result.citation.token+']]'},null),send({},'stop')];
    }
  }else if(prompt.includes('[qa:records]')){
    const kind=prompt.match(/SOURCE_KIND=(\w+)/)[1],id=prompt.match(/SOURCE_ID=(\w+)/)[1],historyId=prompt.match(/HISTORY_ID=(\w+)/)[1];
    const current=payload.messages.slice(payload.messages.lastIndexOf(user)+1).filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
    if(current.length<4){
      const step=current.length,name=step<2?'readBusinessSource':'readHistoryMessage',args={...(step<2?{kind,id}:{id:historyId}),offset:0};
      if(step%2){const first=current[step-1];args.offset=Math.max(0,first.totalCharacters-6000);args.expectedVersion=first.version;}
      chunks=[send({role:'assistant',tool_calls:[{index:0,id:'record-'+step,type:'function',function:{name,arguments:JSON.stringify(args)}}]},null),send({},'tool_calls')];
    }else chunks=[send({role:'assistant',content:current.filter((_x,i)=>i%2).map(r=>r.text.slice(-80)+' [[cite:'+r.citation.token+']]').join('\n')},null),send({},'stop')];
  }else if(last.role==='tool'){
    let result;try{result=JSON.parse(last.content);}catch{result={error:last.content};}
    const source=result.citation||result.results?.[0]?.citation;
    chunks=[send({role:'assistant',content:source?`Source [[cite:${source.token}]]`:`Saved ${result.id||'result'}`},null),send({},'stop')];
  }else if(prompt.includes('[qa:search]')||prompt.includes('[qa:fetch]')){
    const name=prompt.includes('[qa:search]')?'webSearch':'fetchWebPage',args=name==='webSearch'?{query:'public fixture question'}:{url:'https://example.com/public'};
    chunks=[send({role:'assistant',tool_calls:[{index:0,id:'web-1',type:'function',function:{name,arguments:JSON.stringify(args)}}]},null),send({},'tool_calls')];
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
  if(media){
    const rounds=await runMediaScenarios({db,origin,backend:'pi',uploads:env.UPLOAD_DIR,synthetic:!live,taskModes:live?[true]:[false,true],chat:(id,text)=>chat(id,message(text))});
    const receipt={status:'passed',media:true,standalone,electron,live:!!live,model:live?.model||'synthetic-model',requests,usage,rounds};await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }else if(records){
    const rounds=await runRecordScenarios({db,origin,backend:'pi',taskModes:live?[true]:[false,true],chat:(id,text)=>chat(id,message(text))});
    const legacyApi=await db.conversation.create({data:{backend:'api'}});
    assert.equal((await (await fetch(origin+'/api/agent/state?conversationId='+legacyApi.id)).json()).businessToolsAvailable,false);
    if(!live)for(const payload of upstreamPayloads){
      const instructions=JSON.stringify(payload.messages.filter(m=>['system','developer'].includes(m.role)));
      assert.ok(!instructions.includes('DOC-END-')&&!instructions.includes('RESULT-END-'),'Full originals leaked into injected instructions');
    }
    const receipt={status:'passed',records:true,standalone,electron,live:!!live,requests,usage,rounds};
    await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }else if(liveWeb){
    await db.setting.create({data:{key:'webSearch.enabled',value:'true'}});
    const id=randomUUID().replaceAll('-','');
    const result=await chat(id,message('This is a public-information integration test. Use webSearch exactly once for "site:api-docs.deepseek.com Search Fetch API" and then fetchWebPage exactly once to read https://api-docs.deepseek.com/api/search/ . Give a short factual answer with the source citation tokens returned by these tools. Do not use business or file tools.'));
    assert.equal(result.chunks.at(-1).finishReason,'stop',result.raw);
    const runs=await db.codexToolRun.findMany({where:{turn:{conversationId:id}},select:{name:true,status:true}});
    for(const name of ['webSearch','fetchWebPage'])assert.ok(runs.some(r=>r.name===name&&r.status==='completed'),name+' not actually completed');
    assert.ok(runs.every(r=>['webSearch','fetchWebPage'].includes(r.name)));
    const stored=await db.message.findFirst({where:{conversationId:id,role:'secretary'}});assert.match(stored.content,/https:\/\/api-docs.deepseek.com/);assert.doesNotMatch(stored.content,/\[\[cite:/);
    const receipt={status:'passed',checks:['real DeepSeek model tool loop','real Search and Fetch API','actual route persisted web citations'],standalone,electron,live:true,requests,usage,tools:runs};
    await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }else if(process.argv.includes('--followup')){
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
  if(webSearch){
    await db.setting.createMany({data:[{key:'webSearch.enabled',value:'true'},{key:'webSearch.apiKey',value:'synthetic-search-key'}]});
    const searchMessage=message('[qa:search] Search public fixture information');
    result=await chat(id,searchMessage);assert.equal(result.chunks.at(-1).finishReason,'stop',result.raw);assert.match(result.raw,/https:\/\/example.com\/public/);
    const count=requests;await chat(id,searchMessage);assert.equal(requests,count);
    result=await chat(scoped.id,message('[qa:fetch] Read the public fixture page'));assert.equal(result.chunks.at(-1).finishReason,'stop',result.raw);assert.match(result.raw,/https:\/\/example.com\/public/);
    const webRuns=await db.codexToolRun.findMany({where:{name:{in:['webSearch','fetchWebPage']}}});assert.equal(webRuns.length,2);assert.ok(webRuns.every(r=>r.status==='completed'));
    assert.doesNotMatch((await db.message.findFirst({where:{conversationId:scoped.id,role:'secretary'},orderBy:{createdAt:'desc'}})).content,/\[\[cite:/);
    const html=await (await fetch(origin+'/settings')).text();assert.match(html,/name="webSearchEnabled"/);assert.doesNotMatch(html,/synthetic-search-key/);
    await db.setting.update({where:{key:'webSearch.enabled'},data:{value:'false'}});
    result=await chat(id,message('[qa:search-off] Check the current tools'));assert.equal(result.chunks.at(-1).finishReason,'stop',result.raw);
    assert.equal(await db.codexToolRun.count({where:{name:{in:['webSearch','fetchWebPage']}}}),2);
    console.log('PASS real routes: existing Pi chat gains/loses web tools, task chat fetches public page, sources persist, retries deduplicate and settings expose no search key');
  }
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
  const receipt={status:'passed',standalone,electron,live:!!live,webSearch,requests,usage,taskCount:await db.task.count(),attachmentCount:await db.attachment.count(),directory:dir};
  await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
  }
}finally{await stop();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await db.$disconnect();await log.close();}
