#!/usr/bin/env node
// Real local Codex login + actual Next routes, isolated SQL/files and public queries only.
// Creates only synthetic threads and archives them afterwards. Does not read business data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { CodexConnection, resolveExecutable, denyRequest, runTurn } from '../src/lib/codex/protocol.mjs';
import { codexSearchConfig, isWebSearchItem } from '../src/lib/codex/web-search.mjs';
import { runFileScenarios } from './codex-files-cases.mjs';
import { runRecordScenarios } from './agent-records-cases.mjs';
import { legacyDynamicTools } from './codex-legacy-profile.mjs';

if(!process.argv.includes('--live'))throw new Error('Pass --live to use local Codex allowance for public-information tests');
const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'data/codex-search-integration',new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(dir,{recursive:true});const uploads=path.join(dir,'uploads'),workspace=path.join(dir,'codex-workspace');await fs.mkdir(uploads);await fs.mkdir(workspace);
const executable=resolveExecutable(process.env.SECRETARY_CODEX_PATH||'');
const databaseUrl='file:'+path.join(dir,'test.db').replaceAll('\\','/');
const env={...process.env,DATABASE_URL:databaseUrl,UPLOAD_DIR:uploads,AUTH_ENABLED:'false',ALLOW_INSECURE_LOCAL:'true',SESSION_SECRET:'synthetic-codex-test-'.repeat(4),APP_PASSWORD_HASH:'',DESKTOP_APP:'0',ENABLE_LOCAL_CODEX:'true',APP_INSTANCE:'test',NEXT_TELEMETRY_DISABLED:'1',AI_API_KEY:'synthetic-unused',AI_MODEL:'synthetic-unused',SECRETARY_BUILD_DIR:'.next-pi-qa',NODE_ENV:'development'};
env.SECRETARY_TSCONFIG=path.relative(root,path.join(dir,'tsconfig.json')).replaceAll('\\','/');
await fs.writeFile(path.join(root,env.SECRETARY_TSCONFIG),JSON.stringify({extends:path.join(root,'tsconfig.json'),compilerOptions:{baseUrl:root,incremental:false},include:[path.join(root,'src/**/*.ts'),path.join(root,'src/**/*.tsx')],exclude:[path.join(root,'node_modules')]}));
execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate'],{cwd:root,env,stdio:'pipe'});
const db=new PrismaClient({datasourceUrl:databaseUrl});
const recordMode=process.argv.includes('--records');
await db.setting.createMany({data:[{key:'ai.backend',value:'codex'},{key:'codex.path',value:executable},{key:'codex.effort',value:'low'},{key:'codex.webSearch',value:'true'}]});
const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const origin='http://127.0.0.1:'+port;
const log=await fs.open(path.join(dir,'next.log'),'a'),standalone=process.argv.includes('--standalone')||process.argv.includes('--build'),electron=process.argv.includes('--electron');
let child,control;const threads=new Set(),rounds=[];
const stop=async()=>{if(!child||child.exitCode!==null)return;const done=new Promise(r=>child.once('exit',r));if(process.platform==='win32')execFileSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'pipe',windowsHide:true});else child.kill('SIGTERM');await done;};
const chat=async(conversationId,text,parts=[])=>{
  const res=await fetch(origin+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({conversationId,message:{id:randomUUID().replaceAll('-',''),role:'user',parts:[{type:'text',text},...parts]}}),signal:AbortSignal.timeout(240000)});
  const raw=await res.text();assert.equal(res.status,200,raw);const chunks=raw.split('\n').filter(x=>x.startsWith('data: {')).map(x=>JSON.parse(x.slice(6)));assert.equal(chunks.at(-1)?.finishReason,'stop',raw);return chunks;
};
try {
  if(process.argv.includes('--build'))execFileSync(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'build'],{cwd:root,env:{...env,DESKTOP_BUILD:'1',NODE_ENV:'production'},stdio:['ignore',log.fd,log.fd]});
  const bundle=path.join(root,'.next-pi-qa/standalone'),guard=path.join(dir,'guard.cjs');
  if(standalone){
    for(const name of await fs.readdir(bundle))if(name==='.env'||name.startsWith('.env.'))await fs.unlink(path.join(bundle,name));
    await fs.cp(path.join(root,'.next-pi-qa/static'),path.join(bundle,'.next-pi-qa/static'),{recursive:true});await fs.cp(path.join(root,'public'),path.join(bundle,'public'),{recursive:true});
    await fs.writeFile(guard,`const{registerHooks}=require('node:module');const{fileURLToPath}=require('node:url');const{realpathSync}=require('node:fs');const path=require('node:path');const own=${JSON.stringify(bundle)},parent=${JSON.stringify(path.join(root,'node_modules'))};registerHooks({resolve(s,c,next){const r=next(s,c);if(r.url.startsWith('file:')){const f=realpathSync(fileURLToPath(r.url));if(f.startsWith(parent+path.sep)&&!f.startsWith(own+path.sep))throw new Error('Missing standalone dependency: '+s);}return r;}});`);
  }
  child=spawn(electron?path.join(root,'desktop/node_modules/electron/dist/electron.exe'):process.execPath,standalone?['--require',guard,path.join(bundle,'server.js')]:[path.join(root,'node_modules/next/dist/bin/next'),'dev','-p',String(port),'-H','127.0.0.1'],{cwd:standalone?bundle:root,env:{...env,...(electron?{ELECTRON_RUN_AS_NODE:'1'}:{}),PORT:String(port),HOSTNAME:'127.0.0.1',NODE_ENV:standalone?'production':'development'},stdio:['ignore',log.fd,log.fd],windowsHide:true});
  let ready=false;for(let n=0;n<120;n++){if(child.exitCode!==null)throw new Error('Next exited');try{if((await fetch(origin+'/api/agent/state')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready,'Next did not start');
  control=new CodexConnection({executable,cwd:workspace});await control.connect();control.on('request',msg=>denyRequest(control,msg));
  // Prime two old threads with disabled search and a random marker, without platform tools.
  const scenarios=[];
  for(const taskMode of [false,true])for(const existing of [false,true]){
    const task=taskMode?await db.task.create({data:{title:'Synthetic public web test',detail:'Public sources only. No business operation requested.'}}):null;
    const conv=await db.conversation.create({data:{backend:'codex',taskId:task?.id}}),marker=existing?'MEM-'+randomUUID():null;
    let oldThread=null;
    if(existing){
      const r=await control.request('thread/start',{cwd:workspace,config:codexSearchConfig(),sandbox:'read-only',approvalPolicy:'on-request',baseInstructions:'Old secretary fixture: only remember the user marker. No web access. Do not use tools.',dynamicTools:[]});oldThread=r.thread.id;threads.add(oldThread);
      await runTurn(control,{threadId:oldThread,effort:'low',input:[{type:'text',text:'Remember synthetic marker '+marker+'. Reply OK.'}],timeoutMs:120000});
      await db.conversation.update({where:{id:conv.id},data:{codexThreadId:oldThread}});
    }
    scenarios.push({id:conv.id,taskMode,existing,marker,oldThread});
  }
  let legacy=null;
  if(recordMode){
    const marker='LEGACY-CONTEXT-'+randomUUID(),task=await db.task.create({data:{title:'Profile 1 context fixture',detail:'Legacy requirement. '.repeat(100)+marker}});
    const conv=await db.conversation.create({data:{backend:'codex',taskId:task.id}});
    const dynamicTools=await legacyDynamicTools(root,databaseUrl,conv.id,task.id);
    const r=await control.request('thread/start',{cwd:workspace,config:codexSearchConfig(),sandbox:'read-only',approvalPolicy:'on-request',baseInstructions:'Secretary legacy fixture. Reply OK. Use only supplied platform tools when requested.',dynamicTools});
    threads.add(r.thread.id);await runTurn(control,{threadId:r.thread.id,effort:'low',input:[{type:'text',text:'Reply OK only.'}],timeoutMs:120000});
    await db.conversation.update({where:{id:conv.id},data:{codexThreadId:r.thread.id}});
    await db.setting.create({data:{key:'codex.tools.'+conv.id,value:JSON.stringify({version:1,threadId:r.thread.id})}});
    legacy={conv,threadId:r.thread.id,marker};
  }
  // A persistent primer owns its thread writer until its app-server exits.
  // The application must resume only after that private fixture process releases it.
  const primer=control.proc;control.close();if(primer.exitCode===null)await new Promise(r=>primer.once('exit',r));
  control=new CodexConnection({executable,cwd:workspace});await control.connect();control.on('request',msg=>denyRequest(control,msg));
  const fileMode=process.argv.includes('--files');
  if(recordMode){
    await db.setting.update({where:{key:'codex.webSearch'},data:{value:'false'}});
    await runRecordScenarios({db,chat,threads,rounds,origin,backend:'codex'});
    const fileMarker='LEGACY-FILE-'+randomUUID();
    await chat(legacy.conv.id,'Read the uploaded file using readAttachment. Also use readConversationHistory offset=0. Report the exact LEGACY-CONTEXT- marker from the fresh task requirements and the LEGACY-FILE- marker from the file; cite the file using its new token. Do not use web search or change any business records.',[{type:'file',url:'data:text/plain;base64,'+Buffer.from(fileMarker).toString('base64'),mediaType:'text/plain',filename:'legacy-file.txt'}]);
    const state=await (await fetch(origin+'/api/agent/state?conversationId='+legacy.conv.id)).json(),reply=await db.message.findFirstOrThrow({where:{conversationId:legacy.conv.id,role:'secretary'},orderBy:{createdAt:'desc'}});
    assert.equal(state.fileToolsAvailable,true);assert.equal(state.businessToolsAvailable,false);
    assert.ok(reply.content.includes(legacy.marker));assert.ok(reply.content.includes(fileMarker));assert.match(reply.content,/api\/files\//);assert.doesNotMatch(reply.content,/\[\[cite:|来源未核实/);
    assert.equal((await db.conversation.findUniqueOrThrow({where:{id:legacy.conv.id}})).codexThreadId,legacy.threadId);
    for(const name of ['readAttachment','readConversationHistory'])assert.ok(await db.codexToolRun.count({where:{turn:{conversationId:legacy.conv.id},name,status:'completed'}}));
    assert.equal(await db.codexToolRun.count({where:{turn:{conversationId:legacy.conv.id},name:{in:['readBusinessSource','readHistoryMessage']}}}),0);
    rounds.push({legacyProfile:1,threadRetained:true,fullTaskContext:true,fileTools:true,enhancedTools:false});
  }else if(fileMode)await runFileScenarios({db,chat,scenarios,threads,rounds,origin});
  else for(const s of scenarios){
    const chunks=await chat(s.id,'Use public web search exactly once to search for "site:openai.com OpenAI" and open https://openai.com/ exactly once. Give a brief answer and source links. Do not change platform data or use business tools.'+(s.existing?' Also recall the exact synthetic marker from earlier in this thread. Never include that marker in any search query or URL.':''));
    const conv=await db.conversation.findUniqueOrThrow({where:{id:s.id}});threads.add(conv.codexThreadId);if(s.existing)assert.equal(conv.codexThreadId,s.oldThread);
    const reply=await db.message.findFirst({where:{conversationId:s.id,role:'secretary'},orderBy:{createdAt:'desc'}});assert.match(reply.content,/\[[^\]]+\]\(https:\/\/(www\.)?openai.com/);assert.doesNotMatch(reply.content,/|网页来源未核实/);
    if(s.existing)assert.ok(reply.content.includes(s.marker),'Old thread lost marker');
    assert.doesNotMatch(chunks.filter(c=>c.type==='text-delta').map(c=>c.delta).join(''),/|/);
    const history=await control.request('thread/read',{threadId:conv.codexThreadId,includeTurns:true});
    const items=history.thread.turns.at(-1).items,web=items.filter(isWebSearchItem);assert.ok(web.some(i=>i.status==='completed'&&i.arguments?.system2_search_query?.length),'No actual search');assert.ok(web.some(i=>i.status==='completed'&&i.arguments?.open?.length),'No actual page read');
    assert.ok(items.filter(i=>i.type==='mcpToolCall').every(isWebSearchItem),'Unexpected connector used');
    if(s.marker)assert.ok(!JSON.stringify(web.map(i=>i.arguments)).includes(s.marker),'Marker was sent to search');
    const nativeAudits=await db.codexToolRun.findMany({where:{turn:{conversationId:s.id},name:'codexWebSearch'}});assert.equal(nativeAudits.length,web.length);assert.ok(nativeAudits.every(r=>r.status==='completed'&&r.inputJson==='{"native":true}'));
    rounds.push({taskMode:s.taskMode,existing:s.existing,webCalls:web.length,memoryRetained:!s.marker||reply.content.includes(s.marker)});console.log(JSON.stringify(rounds.at(-1)));
  }
  await db.setting.update({where:{key:'codex.webSearch'},data:{value:'false'}});
  const old=scenarios.find(s=>s.existing);await chat(old.id,'Do not search. Recall only the exact synthetic marker already in this thread.');
  const offReply=await db.message.findFirst({where:{conversationId:old.id,role:'secretary'},orderBy:{createdAt:'desc'}});assert.ok(offReply.content.includes(old.marker),'Disabling search lost memory');
  assert.equal((await db.conversation.findUniqueOrThrow({where:{id:old.id}})).codexThreadId,old.oldThread);
  const off=await db.codexTurn.findFirst({where:{conversationId:old.id},orderBy:{createdAt:'desc'}});assert.equal(await db.codexToolRun.count({where:{turnId:off.id,name:'codexWebSearch'}}),0);
  const html=await (await fetch(origin+'/settings')).text();assert.match(html,/name="codexWebSearch"/);
  assert.equal(await db.task.count(),recordMode?5:2);if(!fileMode&&!recordMode)assert.equal(await db.codexToolRun.count({where:{name:{not:'codexWebSearch'}}}),0);
  const receipt={status:'passed',standalone,electron,fileMode,recordMode,rounds,checks:recordMode?['general/task originals and history versioned tail reads','native citations persisted','profile 2 resumes with tools','legacy thread memory retained']:fileMode?['versioned file tail beyond upload preview','source citations and registered output files','new tools persist on resume','legacy threads retain memory and old tools']:['new and old general/task threads search and open real public pages','old thread markers retained and not sent to search','web citations rendered and saved','native activity audit','disable applies to old thread','no business writes'],threadCount:threads.size};
  await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:'passed',directory:dir}));
} catch(e){console.error(e.message);process.exitCode=1;await fs.writeFile(path.join(dir,'failure.json'),JSON.stringify({error:e.message,rounds},null,2));}
finally {
  await stop();for(const c of await db.conversation.findMany({where:{codexThreadId:{not:null}},select:{codexThreadId:true}}))threads.add(c.codexThreadId);
  let archived=0;for(const threadId of threads)try{await control?.request('thread/archive',{threadId});archived++;}catch{}
  const cleanup={status:archived===threads.size?'passed':'incomplete',syntheticThreads:threads.size,archived};
  await fs.writeFile(path.join(dir,'cleanup.json'),JSON.stringify(cleanup,null,2));if(cleanup.status!=='passed')process.exitCode=1;
  console.log(JSON.stringify(cleanup));control?.close();await db.$disconnect();await log.close();
}
