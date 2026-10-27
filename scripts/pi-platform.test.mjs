import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { z } from 'zod';

const root=path.resolve(import.meta.dirname,'..'),directory=path.join(root,'data/pi-platform-tests',Date.now().toString());
await fs.mkdir(directory,{recursive:true});
process.env.DATABASE_URL='file:'+path.join(directory,'test.db').replaceAll('\\','/');
process.env.UPLOAD_DIR=path.join(directory,'uploads');await fs.mkdir(process.env.UPLOAD_DIR,{recursive:true});
execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate'],{env:process.env,stdio:'pipe'});
const hooks=registerHooks({
  resolve(specifier,context,next){
    if(specifier==='next/cache')return{url:'data:text/javascript,export const revalidatePath=()=>{};',shortCircuit:true};
    if(specifier.startsWith('@/')){
      const base=path.join(root,'src',specifier.slice(2)),file=['','.ts','.tsx','/index.ts'].map(e=>base+e).find(existsSync);
      if(!file)throw new Error('Unknown app module '+specifier);return{url:pathToFileURL(file).href,shortCircuit:true};
    }return next(specifier,context);
  },
  load(url,context,next){
    if(url.startsWith('file:')&&url.endsWith('.ts')&&!url.includes('/node_modules/'))return{format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};
    return next(url,context);
  },
});
const {db}=await import('../src/lib/db.ts');
const {buildPiFileTools,verifyPiSource}=await import('../src/lib/pi/files.ts');
const {executeAgentTool,durableAgentResponse,recoverAgentTurns}=await import('../src/lib/agent-turns.ts');
const {storeUpload}=await import('../src/lib/ingest.ts');
const {externalRead}=await import('../src/lib/agent-tool-policy.ts');
const {buildWebTools}=await import('../src/lib/web-search/tools.ts');
const {openPiSession,CitationStream}=await import('../src/lib/pi/runtime.mjs');
const call=async(def,input)=>def.execute(def.inputSchema.parse(input),{toolCallId:'test',messages:[]});
test.after(async()=>{await db.$disconnect();hooks.deregister();});

test('real platform executor atomically saves and deduplicates a business write; cancellation rolls it back',async()=>{
  const conv=await db.conversation.create({data:{backend:'pi'}});
  const turn=await db.codexTurn.create({data:{conversationId:conv.id,requestKey:'test-turn',inputHash:'test',processKey:'test'}});
  const def={inputSchema:z.object({title:z.string()}),execute:async args=>db.task.create({data:args})};
  const options={turnId:turn.id,callId:'tool1',name:'createTask',args:{title:'Synthetic transactional task'},def,signal:new AbortController().signal};
  const first=await executeAgentTool(options),second=await executeAgentTool(options);assert.equal(first.id,second.id);assert.equal(await db.task.count(),1);
  await assert.rejects(executeAgentTool({...options,args:{title:'changed'}}),/mismatch/);
  const abort=new AbortController();
  await assert.rejects(executeAgentTool({...options,callId:'cancelled',signal:abort.signal,def:{...def,execute:async args=>{await def.execute(args);abort.abort();return{ok:true};}}}),/Cancelled/);
  assert.equal(await db.task.count(),1);assert.equal((await db.codexToolRun.findUnique({where:{turnId_callId:{turnId:turn.id,callId:'cancelled'}}})).status,'failed');
});
test('real durable acceptance recovers interrupted receipts and rejects concurrent or changed requests',async()=>{
  const conv=await db.conversation.create({data:{backend:'pi'}});
  const old=await db.codexTurn.create({data:{conversationId:conv.id,requestKey:'interrupted',inputHash:'x',processKey:'previous',status:'running'}});
  await recoverAgentTurns();assert.equal((await db.codexTurn.findUnique({where:{id:old.id}})).status,'failed');
  let release;const blocked=new Promise(r=>release=r);
  const newest={id:'syntheticmessage1',role:'user',parts:[{type:'text',text:'one'}]};
  const generate=async(turn,emit)=>{await blocked;emit({type:'start',messageId:turn.id});emit({type:'finish',finishReason:'stop'});await db.codexTurn.update({where:{id:turn.id},data:{status:'completed'}});};
  const response=await durableAgentResponse({conversationId:conv.id,newest,generate});
  try{
    assert.equal((await durableAgentResponse({conversationId:conv.id,newest:{...newest,id:'syntheticmessage2'},generate})).status,409);
    assert.equal((await durableAgentResponse({conversationId:conv.id,newest:{...newest,parts:[{type:'text',text:'changed'}]},generate})).status,409);
  }finally{release();await response.text();}
});

test('slow external reads release SQL writes, retain receipts and do not replay completed I/O',async()=>{
  const conv=await db.conversation.create({data:{backend:'pi'}}),turn=await db.codexTurn.create({data:{conversationId:conv.id,requestKey:'external-read',inputHash:'x',processKey:'test',status:'completed'}});
  let ready,release,calls=0;const started=new Promise(r=>ready=r),blocked=new Promise(r=>release=r);
  const def=externalRead({inputSchema:z.object({}),execute:async()=>{calls++;ready();await blocked;return {ok:true};}});
  const options={turnId:turn.id,callId:'read',name:'slowRead',args:{},def,signal:new AbortController().signal};
  const work=executeAgentTool(options);await started;
  let timer;
  try {await Promise.race([db.setting.create({data:{key:'test.concurrent',value:'saved while reading'}}),new Promise((_r,reject)=>timer=setTimeout(()=>reject(new Error('Read held SQL write lock')),2000))]);}
  finally {clearTimeout(timer);release();await work;}
  await executeAgentTool(options);assert.equal(calls,1);
  const abort=new AbortController();
  await assert.rejects(executeAgentTool({...options,callId:'read-cancelled',signal:abort.signal,def:externalRead({inputSchema:z.object({}),execute:async()=>{abort.abort();return {ok:true};}})}));
  assert.equal((await db.codexToolRun.findUnique({where:{turnId_callId:{turnId:turn.id,callId:'read-cancelled'}}})).status,'failed');
});

test('Pi executes actual web tool loop, records sources and refreshes tools in an existing session',async()=>{
  const conv=await db.conversation.create({data:{backend:'pi'}}),turn=await db.codexTurn.create({data:{conversationId:conv.id,requestKey:'web-loop',inputHash:'x',processKey:'test',status:'completed'}});
  const stream=new CitationStream(),requests=[];
  const defs=buildWebTools({enabled:true,apiKey:'synthetic'},new AbortController().signal,async(url,init)=>{
    requests.push({url,body:JSON.parse(init.body)});
    return Response.json(url.endsWith('/search')?{results:[{title:'Synthetic primary source',url:'https://example.com/source',snippet:'public summary',summary:'Synthetic summary'}]}:{title:'Synthetic primary source',content:'Verified public page J7X9'});
  });
  const tools=Object.entries(defs).map(([name,def])=>({name,label:name,description:def.description,parameters:z.toJSONSchema(def.inputSchema,{io:'input'}),execute:async(callId,args)=>{
    const result=await executeAgentTool({turnId:turn.id,callId,name,args,def,signal:new AbortController().signal});
    for(const source of result.results?.map(r=>r.citation)||[result.citation])if(source)stream.register(source.token,source);
    return {content:[{type:'text',text:JSON.stringify(result)}],details:{}};
  }}));
  let replies=0;
  const cfg={baseUrl:'https://synthetic.invalid/v1',apiKey:'synthetic-chat',model:'synthetic'};
  const directory=path.join(process.env.UPLOAD_DIR,'pi-web');
  const fetchImpl=async(_input,init)=>{
    const payload=JSON.parse(init.body);replies++;
    let delta,finish;
    if(replies<3){const name=replies===1?'webSearch':'fetchWebPage',args=replies===1?{query:'public question'}:{url:'https://example.com/source'};delta={role:'assistant',tool_calls:[{index:0,id:'web'+replies,type:'function',function:{name,arguments:JSON.stringify(args)}}]};finish='tool_calls';}
    else {const source=JSON.parse(payload.messages.filter(m=>m.role==='tool').at(-1).content).citation;delta={role:'assistant',content:'Public answer [[cite:'+source.token+']]'};finish='stop';}
    return new Response([{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:40,completion_tokens:20,total_tokens:60}}].map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  let run=await openPiSession({directory,cfg,instructions:'Use supplied web tools',tools,fetchImpl});
  try {run.session.subscribe(e=>{if(e.type==='message_update'&&e.assistantMessageEvent.type==='text_delta')stream.push(e.assistantMessageEvent.delta);});await run.session.prompt('Search then read source');}
  finally {run.session.dispose();}
  stream.push('',true);assert.match(stream.text,/https:\/\/example.com\/source/);assert.equal(stream.used[0].kind,'web');assert.equal(requests.length,2);assert.equal(await db.codexToolRun.count({where:{turnId:turn.id,status:'completed'}}),2);
  assert.deepEqual(requests[0].body,{query:'public question',count:5,need_content:false});
  run=await openPiSession({directory,cfg,instructions:'Search now disabled',tools:[],fetchImpl});
  try {assert.deepEqual(run.session.getActiveToolNames(),[]);assert.ok(run.session.messages.length>2);assert.deepEqual(buildWebTools({enabled:false,apiKey:'synthetic'},new AbortController().signal),{});}
  finally {run.session.dispose();}
  const unknown=new CitationStream();assert.match(unknown.push('[[cite:'+stream.used[0].token+']]'),/来源未核实/);
});
test('real attachment reading enforces task scope, pagination, file versions and hardlink/path boundaries',async()=>{
  const conv=await db.conversation.create({data:{backend:'pi'}}),msg=await db.message.create({data:{conversationId:conv.id,role:'user',content:'test'}});
  const stored=await storeUpload(Buffer.from('S'.repeat(12000)+'MARKER'),'synthetic.txt','text/plain');
  const attachment=await db.attachment.create({data:{...stored,messageId:msg.id}});
  const tools=buildPiFileTools(conv.id,null,msg.id),other=buildPiFileTools('a'.repeat(24),'other-task',msg.id);
  const first=await call(tools.readAttachment,{attachmentId:attachment.id});assert.equal(first.nextOffset,12000);
  const tail=await call(tools.readAttachment,{attachmentId:attachment.id,offset:12000});assert.equal(tail.text,'MARKER');assert.equal(tail.nextOffset,null);
  assert.equal((await call(tools.listAttachments,{})).nextOffset,null);
  await assert.rejects(call(other.readAttachment,{attachmentId:attachment.id}),/scope/);
  await verifyPiSource(first.citation,conv.id,null);
  const file=path.join(process.env.UPLOAD_DIR,stored.storedPath);await fs.writeFile(file,'changed');
  await assert.rejects(verifyPiSource(first.citation,conv.id,null),/changed/);
  const linked=path.join(process.env.UPLOAD_DIR,'linked.txt');await fs.link(file,linked);
  await assert.rejects(call(tools.readAttachment,{attachmentId:attachment.id}),/type or size/);await fs.unlink(linked);
  const outside=await db.attachment.create({data:{filename:'outside.txt',storedPath:'../test.db',mimeType:'text/plain',size:1}});
  await assert.rejects(call(tools.readAttachment,{attachmentId:outside.id}),/path denied/);
  await assert.rejects(call(tools.createOutputFile,{filename:'../outside.md',content:'x'}));
});
test('real PDF tool reads the requested page and generated files preserve original evidence',async()=>{
  const text='Synthetic PDF marker';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${text.length+31} >>\nstream\nBT /F1 12 Tf 30 200 Td (${text}) Tj ET\nendstream`];
  let pdf='%PDF-1.4\n',offsets=[0];for(const [i,object]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const conv=await db.conversation.create({data:{backend:'pi'}}),msg=await db.message.create({data:{conversationId:conv.id,role:'secretary',content:'test'}});
  const stored=await storeUpload(Buffer.from(pdf),'synthetic.pdf','application/pdf'),attachment=await db.attachment.create({data:{...stored,messageId:msg.id}});
  const tools=buildPiFileTools(conv.id,null,msg.id),read=await call(tools.readAttachment,{attachmentId:attachment.id});assert.match(read.text,/Synthetic PDF marker/);assert.match(read.citation.url,/#page=1$/);
  await assert.rejects(call(tools.readAttachment,{attachmentId:attachment.id,page:2}),/out of range/);
  const output=await call(tools.createOutputFile,{filename:'result.md',content:'New output'});assert.ok(output.id);assert.equal((await db.attachment.findUnique({where:{id:output.id}})).messageId,msg.id);
  await verifyPiSource(read.citation,conv.id,null);
});
test('backup and restore carry the Pi mapping and session together with the isolated database',async()=>{
  const sessions=path.join(directory,'pi-sessions','synthetic-conversation');await fs.mkdir(sessions,{recursive:true});
  const mapping='{"sessionFile":"synthetic.jsonl"}',context='{"type":"synthetic-session","marker":"J7X9"}\n';
  await fs.writeFile(path.join(sessions,'manifest.json'),mapping);await fs.writeFile(path.join(sessions,'synthetic.jsonl'),context);
  const env={...process.env,BACKUP_DIR:path.join(directory,'backups'),BACKUP_STAGE_DIR:path.join(directory,'backup-stage')};
  execFileSync(process.execPath,[path.join(root,'scripts/backup.mjs'),'--plain'],{cwd:root,env,stdio:'pipe'});
  execFileSync(process.execPath,[path.join(root,'scripts/restore.mjs'),'latest','--to',path.join(directory,'restored')],{cwd:root,env,stdio:'pipe'});
  const restored=path.join(directory,'restored/pi-sessions/synthetic-conversation');
  assert.equal(await fs.readFile(path.join(restored,'manifest.json'),'utf8'),mapping);assert.equal(await fs.readFile(path.join(restored,'synthetic.jsonl'),'utf8'),context);
  const conv=await db.conversation.findFirst({where:{backend:'pi'}});
  await db.codexTurn.create({data:{conversationId:conv.id,requestKey:'busy-backup',inputHash:'x',processKey:'test',status:'running'}});
  assert.throws(()=>execFileSync(process.execPath,[path.join(root,'scripts/backup.mjs'),'--plain'],{cwd:root,env,stdio:'pipe'}),/Command failed/);
});
