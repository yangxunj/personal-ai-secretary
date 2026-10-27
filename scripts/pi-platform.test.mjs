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
import { mediaFixtures } from './media-fixtures.mjs';

const root=path.resolve(import.meta.dirname,'..'),directory=path.join(root,'data/pi-platform-tests',Date.now().toString());
await fs.mkdir(directory,{recursive:true});
process.env.DATABASE_URL='file:'+path.join(directory,'test.db').replaceAll('\\','/');
process.env.UPLOAD_DIR=path.join(directory,'uploads');await fs.mkdir(process.env.UPLOAD_DIR,{recursive:true});
execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate'],{env:process.env,stdio:'pipe'});
const hooks=registerHooks({
  resolve(specifier,context,next){
    if(specifier==='next/cache')return{url:'data:text/javascript,export const revalidatePath=()=>{};',shortCircuit:true};
    if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){
      const base=fileURLToPath(new URL(specifier,context.parentURL)),file=['.ts','/index.ts'].map(e=>base+e).find(existsSync);
      if(file)return{url:pathToFileURL(file).href,shortCircuit:true};
    }
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
const {buildAgentFileTools}=await import('../src/lib/agent-files.ts');
const {extractDoc}=await import('../src/lib/doc-extract.ts');
const {hasCodexFileTools,getCodexToolVersion,codexToolProfileKey}=await import('../src/lib/codex/tool-profile.ts');
const {buildAgentRecordTools}=await import('../src/lib/agent-records.ts');
const {verifyPlatformSource}=await import('../src/lib/agent-source-verifier.ts');
const {lightTaskChatContext,taskChatInstructions}=await import('../src/lib/task-chat-context.ts');
const {buildChatTools}=await import('../src/lib/task-chat-tools.ts');
const {textPage}=await import('../src/lib/agent-text.ts');
const {buildAgentMediaTools,piToolContent,codexToolContent,visibleMediaResult}=await import('../src/lib/agent-media.ts');
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
  await db.message.create({data:{id:old.id,conversationId:conv.id,role:'secretary',content:''}});
  await db.codexToolRun.create({data:{turnId:old.id,callId:'interrupted-read',name:'readAttachment',inputJson:'{}'}});
  await recoverAgentTurns();assert.equal((await db.codexTurn.findUnique({where:{id:old.id}})).status,'failed');
  assert.match((await db.message.findUnique({where:{id:old.id}})).content,/Interrupted/);
  assert.equal((await db.codexToolRun.findUnique({where:{turnId_callId:{turnId:old.id,callId:'interrupted-read'}}})).status,'failed');
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
  await assert.rejects(call(tools.readAttachment,{attachmentId:attachment.id,offset:12000}),/expectedVersion/);
  const tail=await call(tools.readAttachment,{attachmentId:attachment.id,offset:12000,expectedVersion:first.version});assert.equal(tail.text,'MARKER');assert.equal(tail.nextOffset,null);
  assert.equal((await call(tools.listAttachments,{})).nextOffset,null);
  await assert.rejects(call(other.readAttachment,{attachmentId:attachment.id}),/scope/);
  await verifyPiSource(first.citation,conv.id,null);
  const file=path.join(process.env.UPLOAD_DIR,stored.storedPath);await fs.writeFile(file,'changed');
  await assert.rejects(call(tools.readAttachment,{attachmentId:attachment.id,offset:12000,expectedVersion:first.version}),/version changed/);
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
  const layout=await call(buildAgentMediaTools(conv.id,null).readDocumentPart,{attachmentId:attachment.id,partId:'page:1'}),position=layout.text.split('\n').map(JSON.parse).find(i=>i.text.includes('Synthetic PDF marker'));
  assert.equal(position.x,30);assert.equal(position.y,100);assert.ok(position.width>0);assert.match(layout.citation.url,/#page=1$/);
  await assert.rejects(call(tools.readAttachment,{attachmentId:attachment.id,page:2,expectedVersion:read.version}),/out of range/);
  const output=await call(tools.createOutputFile,{filename:'result.md',content:'New output'});assert.ok(output.id);assert.equal((await db.attachment.findUnique({where:{id:output.id}})).messageId,msg.id);
  await verifyPiSource(read.citation,conv.id,null);
});
test('shared tools fully continue large DOCX/XLSX originals while upload previews remain bounded',async()=>{
  assert.equal(buildPiFileTools,buildAgentFileTools);
  const XLSX=await import('xlsx'),marker='TAIL-'+Date.now(),body='Synthetic text '.repeat(4200)+marker;
  const zip=XLSX.CFB.utils.cfb_new();
  for(const [name,xml] of Object.entries({
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+body+'</w:t></w:r></w:p></w:body></w:document>',
  }))XLSX.CFB.utils.cfb_add(zip,name,Buffer.from(xml));
  const docx=XLSX.CFB.write(zip,{fileType:'zip',type:'buffer'}),wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([...Array.from({length:30},()=>['Synthetic cell '.repeat(150)]),[marker]]),'Evidence');
  const xlsx=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  const conv=await db.conversation.create({data:{backend:'pi'}}),msg=await db.message.create({data:{role:'user',content:'fixture',conversationId:conv.id}}),tools=buildAgentFileTools(conv.id,null,msg.id);
  for(const [kind,bytes]of [['docx',docx],['xlsx',xlsx]]){
    const preview=await extractDoc(kind,bytes,false);assert.ok(preview.text.length<=40960);assert.ok(!preview.text.includes(marker));
    const file=await storeUpload(bytes,'large.'+kind,'application/octet-stream'),attachment=await db.attachment.create({data:{...file,messageId:msg.id}});
    let page=await call(tools.readAttachment,{attachmentId:attachment.id}),text=page.text,version=page.version;
    assert.ok(page.totalCharacters>40960);
    while(page.nextOffset!==null){page=await call(tools.readAttachment,{attachmentId:attachment.id,offset:page.nextOffset,expectedVersion:version});assert.equal(page.version,version);text+=page.text;}
    assert.ok(text.includes(marker));assert.equal(text.length,page.totalCharacters);await verifyPiSource(page.citation,conv.id,null);
  }
});

test('Codex tool profile binds the exact thread and never upgrades legacy tools silently',async()=>{
  const conv=await db.conversation.create({data:{backend:'codex',codexThreadId:'old-thread'}});
  assert.equal(await hasCodexFileTools(conv.id,null),true);assert.equal(await hasCodexFileTools(conv.id,'old-thread'),false);
  await db.setting.create({data:{key:codexToolProfileKey(conv.id),value:JSON.stringify({version:1,threadId:'new-thread'})}});
  assert.equal(await hasCodexFileTools(conv.id,'old-thread'),false);assert.equal(await hasCodexFileTools(conv.id,'new-thread'),true);
  assert.equal(await getCodexToolVersion(conv.id,null),3);assert.equal(await getCodexToolVersion(conv.id,'new-thread'),1);
  await db.setting.update({where:{key:codexToolProfileKey(conv.id)},data:{value:JSON.stringify({version:2,threadId:'v2-thread'})}});
  assert.equal(await getCodexToolVersion(conv.id,'new-thread'),0);assert.equal(await getCodexToolVersion(conv.id,'v2-thread'),2);
  await db.setting.update({where:{key:codexToolProfileKey(conv.id)},data:{value:JSON.stringify({version:3,threadId:'rich-thread'})}});
  assert.equal(await getCodexToolVersion(conv.id,'rich-thread'),3);assert.equal(await getCodexToolVersion(conv.id,'v2-thread'),0);
  await db.setting.update({where:{key:codexToolProfileKey(conv.id)},data:{value:'invalid json'}});assert.equal(await hasCodexFileTools(conv.id,'new-thread'),false);
});

test('business originals continue beyond preview limits with role-specific citations and final version checks',async()=>{
  const marker='ORIGINAL-END-'+Date.now(),body='Original evidence. '.repeat(2400)+marker;
  const doc=await db.document.create({data:{title:'Source document',body}}),topic=await db.topic.create({data:{title:'Source topic',body}});
  const task=await db.task.create({data:{title:'Large source fixture',detail:body,result:body,docId:doc.id,topicId:topic.id}});
  const conv=await db.conversation.create({data:{backend:'pi',taskId:task.id}});
  const note=await db.message.create({data:{role:'user',content:body,taskId:task.id}}),progress=await db.message.create({data:{role:'secretary',content:body,taskId:task.id}});
  const tools=buildAgentRecordTools(conv.id,task.id,'assistant-current'),citations=new CitationStream();
  for(const [kind,id,role]of [['taskDetail',task.id,'originalRequirement'],['taskResult',task.id,'savedResult'],['document',doc.id,'documentText'],['topic',topic.id,'topicText'],['taskMessage',note.id,'userComment'],['taskMessage',progress.id,'savedProgress']]){
    let page=await call(tools.readBusinessSource,{kind,id}),text=page.text;
    assert.equal(page.sourceRole,role);assert.equal(page.totalCharacters,body.length);
    await assert.rejects(call(tools.readBusinessSource,{kind,id,offset:page.nextOffset}),/expectedVersion/);
    while(page.nextOffset!==null){page=await call(tools.readBusinessSource,{kind,id,offset:page.nextOffset,expectedVersion:page.version});text+=page.text;}
    assert.equal(text,body);assert.ok(text.includes(marker));await verifyPlatformSource(page.citation,conv.id,task.id,'assistant-current');
    citations.register(page.citation.token,page.citation);citations.push('[[cite:'+page.citation.token+']]');
  }
  assert.equal(citations.used.length,6,'Different business source roles must not merge');
  const first=await call(tools.readBusinessSource,{kind:'document',id:doc.id});
  await db.document.update({where:{id:doc.id},data:{body:'Changed original'}});
  await assert.rejects(call(tools.readBusinessSource,{kind:'document',id:doc.id,offset:first.nextOffset,expectedVersion:first.version}),/version changed/);
  await assert.rejects(verifyPlatformSource(first.citation,conv.id,task.id,'assistant-current'),/changed/);
  const current=await call(tools.readBusinessSource,{kind:'document',id:doc.id});await db.task.update({where:{id:task.id},data:{docId:null}});
  await assert.rejects(verifyPlatformSource(current.citation,conv.id,task.id,'assistant-current'),/scope/);
  const saved=await call(tools.readBusinessSource,{kind:'taskMessage',id:note.id});await db.message.delete({where:{id:note.id}});
  await assert.rejects(verifyPlatformSource(saved.citation,conv.id,task.id,'assistant-current'),/removed/);
});

test('light task context reduces injected text while all originals remain reachable and legacy paths stay intact',async()=>{
  const body='Long requirements. '.repeat(2400)+'TAIL-UNINJECTED';
  const doc=await db.document.create({data:{title:'Light context document',body}}),topic=await db.topic.create({data:{title:'Light context topic',body}});
  const task=await db.task.create({data:{title:'Light context fixture',detail:body,result:body,docId:doc.id,topicId:topic.id}});
  for(let i=0;i<8;i++)await db.message.create({data:{role:i%2?'user':'secretary',taskId:task.id,content:body}});
  const legacy=await taskChatInstructions(task.id,true),light=await taskChatInstructions(task.id,true,true),snapshot=await lightTaskChatContext(task.id);
  assert.ok(light.length<legacy.length/5);assert.ok(!light.includes('TAIL-UNINJECTED'));assert.equal(snapshot.messages.length,5);assert.equal(snapshot._count.messages,8);
  assert.equal(snapshot.doc.source.totalCharacters,body.length);assert.equal(snapshot.doc.body,undefined);assert.equal(snapshot.sources.detail.totalCharacters,body.length);
  const ctx={incoming:[],conversationId:'light-fixture'};
  const general=await call(buildChatTools({...ctx,progressiveRead:true}).listTasks,{keyword:task.title});
  assert.equal(general.tasks[0].detail.length,400);assert.equal(general.tasks[0].sources.detail.version,snapshot.sources.detail.version);
  assert.equal((await call(buildChatTools(ctx).listTasks,{keyword:task.title})).tasks[0].detail,body);
  assert.equal((await call(buildChatTools({...ctx,taskId:task.id}).listTasks,{})).tasks[0].detail,body.slice(0,20000));
  const scoped=buildChatTools({...ctx,taskId:task.id,progressiveRead:true});
  await assert.rejects(call(scoped.updateTask,{id:'other-task',result:'bad'}),/scope|current|当前|只能/i);
  await assert.rejects(call(scoped.updateTask,{id:task.id,detail:'overwrite'}));
  assert.equal((await db.task.findUnique({where:{id:task.id}})).detail,body);
  console.log(JSON.stringify({check:'light-context',legacyCharacters:legacy.length,lightCharacters:light.length,reduction:1-light.length/legacy.length}));
});

test('record tools enforce task links, task comments and conversation history scope',async()=>{
  const other=await db.task.create({data:{title:'Other record task',detail:'Private original'}}),doc=await db.document.create({data:{title:'Other document',body:'Original'}}),topic=await db.topic.create({data:{title:'Other topic',body:'Original'}});
  const task=await db.task.create({data:{title:'Restricted record task'}}),conv=await db.conversation.create({data:{backend:'pi',taskId:task.id}}),otherConv=await db.conversation.create({data:{backend:'pi'}});
  const wrong=await db.message.create({data:{role:'user',content:'Other history',conversationId:otherConv.id}}),chat=await db.message.create({data:{role:'user',content:'Task chat is not business progress',taskId:task.id,conversationId:conv.id}});
  const scoped=buildAgentRecordTools(conv.id,task.id,'current'),general=buildAgentRecordTools(conv.id,null,'current');
  for(const [kind,id]of [['taskDetail',other.id],['document',doc.id],['topic',topic.id],['taskMessage',chat.id]])await assert.rejects(call(scoped.readBusinessSource,{kind,id}),/scope/);
  await assert.rejects(call(scoped.readHistoryMessage,{id:wrong.id}),/conversation/);
  await assert.rejects(call(scoped.listTaskMessages,{taskId:other.id}),/scope/);
  await assert.rejects(call(general.listTaskMessages,{}),/taskId/);
  assert.equal((await call(scoped.listBusinessSources,{kind:'document'})).total,0);
  assert.equal((await call(general.listBusinessSources,{kind:'document',query:doc.title})).sources[0].id,doc.id);
  assert.equal((await call(general.readBusinessSource,{kind:'taskDetail',id:other.id})).text,'Private original');
  assert.equal((await call(scoped.readConversationHistory,{})).messages[0].id,chat.id);
  assert.equal((await call(scoped.listTaskMessages,{})).messages.length,0);
});

test('history keyword/date previews and single-message originals preserve versions and exclude current assistant',async()=>{
  const conv=await db.conversation.create({data:{backend:'pi'}}),date=new Date('2026-01-02T12:00:00Z');
  const old=await db.message.create({data:{role:'user',conversationId:conv.id,content:'needle '+ 'H'.repeat(19000)+'HISTORY-END',createdAt:date}});
  const current=await db.message.create({data:{role:'secretary',conversationId:conv.id,content:'needle current',createdAt:date}});
  await db.message.create({data:{role:'user',conversationId:conv.id,content:'needle outside range',createdAt:new Date('2026-01-04T00:00:00Z')}});
  const tools=buildAgentRecordTools(conv.id,null,current.id),list=await call(tools.readConversationHistory,{query:'needle',since:'2026-01-02T00:00:00Z',until:'2026-01-03T00:00:00Z'});
  assert.equal(list.messages.length,1);assert.equal(list.messages[0].content.length,800);assert.equal(list.messages[0].sourceRole,'conversationHistory');
  let page=await call(tools.readHistoryMessage,{id:old.id}),text=page.text;assert.equal(page.version,list.messages[0].version);
  while(page.nextOffset!==null){page=await call(tools.readHistoryMessage,{id:old.id,offset:page.nextOffset,expectedVersion:page.version});text+=page.text;}
  assert.ok(text.endsWith('HISTORY-END'));await verifyPlatformSource(page.citation,conv.id,null,current.id);
  await assert.rejects(call(tools.readHistoryMessage,{id:current.id}),/conversation/);
  await db.message.update({where:{id:old.id},data:{content:'Edited history'}});
  await assert.rejects(verifyPlatformSource(page.citation,conv.id,null,current.id),/changed/);
  await assert.rejects(call(tools.readConversationHistory,{since:'2026-02-01T00:00:00Z',until:'2026-01-01T00:00:00Z'}),/date range/);
});

test('history keyset cursor survives anchor deletion, bounds later inserts and rejects scope/filter/date tampering',async()=>{
  const conv=await db.conversation.create({data:{backend:'pi'}}),date=new Date('2026-01-01T00:00:00Z'),prefix='cursor'+Date.now();
  const ids=Array.from({length:33},(_,i)=>prefix+String(i).padStart(3,'0'));
  await db.message.createMany({data:ids.map(id=>({id,role:'user',content:'match '+'X'.repeat(900),conversationId:conv.id,createdAt:date}))});
  const tools=buildAgentRecordTools(conv.id,null,'current'),first=await call(tools.readConversationHistory,{query:'match'});
  assert.equal(first.messages.length,15);assert.deepEqual(first.messages.map(m=>m.id),ids.slice(0,15));
  assert.ok(first.messages.every(m=>m.content.length===800));assert.equal(first.nextOffset,15);
  await db.message.delete({where:{id:ids[14]}});
  await db.message.create({data:{role:'user',content:'match new',conversationId:conv.id,createdAt:new Date('2026-01-02T00:00:00Z')}});
  const second=await call(tools.readConversationHistory,{cursor:first.nextCursor}),last=await call(tools.readConversationHistory,{cursor:second.nextCursor});
  assert.deepEqual([...first.messages,...second.messages,...last.messages].map(m=>m.id),ids);assert.equal(last.nextCursor,null);assert.equal(last.nextOffset,null);
  await assert.rejects(call(tools.readConversationHistory,{cursor:first.nextCursor,query:'different'}),/filters/);
  await assert.rejects(call(buildAgentRecordTools('other-conversation',null,'current').readConversationHistory,{cursor:first.nextCursor}),/scope/);
  const forged=JSON.parse(Buffer.from(first.nextCursor,'base64url').toString());forged.since='invalid-date';
  await assert.rejects(call(tools.readConversationHistory,{cursor:Buffer.from(JSON.stringify(forged)).toString('base64url')}),/Invalid message cursor/);
});

test('record text continuation protects emoji boundaries and refuses out-of-range offsets',()=>{
  const body='a'.repeat(5999)+'😀END',first=textPage(body,0,undefined,'v1');assert.equal(first.nextOffset,5999);
  assert.equal(first.text+textPage(body,first.nextOffset,'v1','v1').text,body);
  assert.throws(()=>textPage(body,6000,'v1','v1'),/nextOffset/);
  assert.throws(()=>textPage(body,body.length+1,'v1','v1'),/range/);
  assert.equal(textPage(body,body.length,'v1','v1').nextOffset,null);
});

test('rich Word reads preserve parts, tables, revisions, comments, headers and notes with scoped versioned citations',async()=>{
  const f=await mediaFixtures(),conv=await db.conversation.create({data:{backend:'pi'}}),msg=await db.message.create({data:{conversationId:conv.id,role:'user',content:'Synthetic rich document'}});
  const stored=await storeUpload(f.docx,'rich.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),a=await db.attachment.create({data:{...stored,messageId:msg.id}}),tools=buildAgentMediaTools(conv.id,null);
  const index=await call(tools.inspectAttachment,{attachmentId:a.id});assert.equal(index.entries.length,7);assert.equal(index.nextOffset,null);
  let page=await call(tools.readDocumentPart,{attachmentId:a.id,partId:'word/document.xml',expectedVersion:index.version}),text=page.text;
  await assert.rejects(call(tools.readDocumentPart,{attachmentId:a.id,partId:'word/document.xml',offset:page.nextOffset}),/expectedVersion/);
  while(page.nextOffset!==null){page=await call(tools.readDocumentPart,{attachmentId:a.id,partId:'word/document.xml',offset:page.nextOffset,expectedVersion:index.version});text+=page.text;}
  for(const token of ['[paragraph 1]','[table 1]','[cell]','[del id=1','Deleted text','[ins id=2','Inserted text','commentReference id=4','footnoteReference id=7','headerReference','external or unavailable image'])assert.ok(text.includes(token),token);
  for(const [part,marker]of [['comments','COMMENT-MARK'],['header1','HEADER-MARK'],['footer1','FOOTER-MARK'],['footnotes','FOOTNOTE-MARK'],['endnotes','ENDNOTE-MARK']])assert.ok((await call(tools.readDocumentPart,{attachmentId:a.id,partId:'word/'+part+'.xml',expectedVersion:index.version})).text.includes(marker));
  const image=await call(tools.readAttachmentVisual,{attachmentId:a.id,imageId:'word/media/image1.png',expectedVersion:index.version});assert.ok(image.image.data);assert.equal(image.image.width,700);
  await verifyPlatformSource(page.citation,conv.id,null,'current');await verifyPlatformSource(image.citation,conv.id,null,'current');
  await assert.rejects(call(tools.readAttachmentVisual,{attachmentId:a.id,imageId:'word/media/unreferenced.png'}),/scope/);
  await assert.rejects(call(tools.readDocumentPart,{attachmentId:a.id,partId:'../outside.xml'}),/scope/);
  await assert.rejects(call(buildAgentMediaTools('other-conv','other-task').inspectAttachment,{attachmentId:a.id}),/scope/);
  await fs.writeFile(path.join(process.env.UPLOAD_DIR,stored.storedPath),await (await import('./media-fixtures.mjs')).richWord('CHANGED'));
  await assert.rejects(call(tools.readDocumentPart,{attachmentId:a.id,partId:'word/document.xml',expectedVersion:index.version}),/version changed/);
  await assert.rejects(verifyPlatformSource(image.citation,conv.id,null,'current'),/changed/);
});

test('scanned PDF pages beyond upload preview render and crop without a text layer; originals remain intact',async()=>{
  const f=await mediaFixtures(),conv=await db.conversation.create({data:{backend:'pi'}}),stored=await storeUpload(f.pdf,'scan.pdf','application/pdf'),a=await db.attachment.create({data:stored}),tools=buildAgentMediaTools(conv.id,null);
  const index=await call(tools.inspectAttachment,{attachmentId:a.id});assert.equal(index.totalPages,8);
  const layout=await call(tools.readDocumentPart,{attachmentId:a.id,partId:'page:8',expectedVersion:index.version});assert.equal(layout.text,'');assert.match(layout.note,/requires visual/);
  const full=await call(tools.readAttachmentVisual,{attachmentId:a.id,page:8,expectedVersion:index.version});assert.equal(full.totalPages,8);assert.match(full.citation.url,/#page=8$/);assert.equal(full.image.width,1400);
  const crop=await call(tools.readAttachmentVisual,{attachmentId:a.id,page:8,crop:{x:0.3,y:0.25,width:0.65,height:0.3},expectedVersion:index.version});assert.ok(crop.image.width<=2200);assert.ok(crop.image.height<full.image.height);assert.notEqual(crop.image.data,full.image.data);
  const rotated=await db.attachment.create({data:await storeUpload((await import('./media-fixtures.mjs')).scanPdf('ROTATED',90),'rotated.pdf','application/pdf')});
  const rotatedView=await call(tools.readAttachmentVisual,{attachmentId:rotated.id,page:8});assert.equal(rotatedView.image.width,720);assert.equal(rotatedView.image.height,1400);
  await fs.writeFile(path.join(directory,'scan-page-8.png'),Buffer.from(full.image.data,'base64'));await fs.writeFile(path.join(directory,'scan-crop.png'),Buffer.from(crop.image.data,'base64'));
  await assert.rejects(call(tools.readAttachmentVisual,{attachmentId:a.id,page:9}),/range/);
  await assert.rejects(call(tools.readAttachmentVisual,{attachmentId:a.id,crop:{x:0.9,y:0,width:0.2,height:1}}));
  assert.deepEqual(await fs.readFile(path.join(process.env.UPLOAD_DIR,stored.storedPath)),f.pdf);await verifyPlatformSource(crop.citation,conv.id,null,'current');
  console.log(JSON.stringify({visualEvidence:directory,scanMarker:f.markers.scan}));
});

test('native multimodal outputs contain image blocks while UI/text expose bounded metadata and text-only models decline',async()=>{
  const f=await mediaFixtures(),conv=await db.conversation.create({data:{backend:'pi'}}),a=await db.attachment.create({data:await storeUpload(f.image,'image.png','image/png')}),tools=buildAgentMediaTools(conv.id,null);
  const result=await call(tools.readAttachmentVisual,{attachmentId:a.id}),pi=piToolContent(result),codex=codexToolContent(result);
  assert.equal(pi[1].type,'image');assert.equal(codex[1].type,'inputImage');assert.match(codex[1].imageUrl,/^data:image\/png;base64,/);
  assert.ok(!JSON.stringify(visibleMediaResult(result)).includes(result.image.data));assert.ok(!pi[0].text.includes(result.image.data));assert.ok(result.image.width<=2200);
  const citations=new CitationStream();citations.register('unsafe',{...result.citation,locator:'image ](https://injected.invalid)\n<bad>'});citations.push('[[cite:unsafe]]');assert.ok(!citations.appendix().includes('](https://injected.invalid)'));
  for(let i=1;i<6;i++)await call(tools.readAttachmentVisual,{attachmentId:a.id});await assert.rejects(call(tools.readAttachmentVisual,{attachmentId:a.id}),/budget/);
  const unsupported=await call(buildAgentMediaTools(conv.id,null,{seesImages:false}).readAttachmentVisual,{attachmentId:a.id});assert.equal(unsupported.ok,false);assert.equal(unsupported.code,'model_has_no_vision');assert.equal(piToolContent(unsupported).length,1);
  const sharp=(await import('sharp')).default,huge=await sharp({create:{width:5000,height:5000,channels:3,background:'white'}}).png().toBuffer(),big=await db.attachment.create({data:await storeUpload(huge,'large.png','image/png')});
  await assert.rejects(call(buildAgentMediaTools(conv.id,null).readAttachmentVisual,{attachmentId:big.id}),/pixel limit/);
  const oriented=await sharp(f.image).jpeg().withMetadata({orientation:6}).toBuffer(),orientedFile=await db.attachment.create({data:await storeUpload(oriented,'oriented.jpg','image/jpeg')});
  const view=await call(buildAgentMediaTools(conv.id,null).readAttachmentVisual,{attachmentId:orientedFile.id});assert.equal(view.image.width,360);assert.equal(view.image.height,700);
});

test('Word parser rejects excessive decompression and XML entities rather than silently omitting sources',async()=>{
  const JSZip=(await import('jszip')).default,{wordStructure}=await import('../src/lib/docx-structure.ts');
  const zip=new JSZip();zip.file('word/document.xml','<!DOCTYPE x [<!ENTITY secret "hidden">]><x/>');await assert.rejects(wordStructure(await zip.generateAsync({type:'nodebuffer'})),/Unsupported/);
  zip.file('word/document.xml','A'.repeat(5*1024*1024));await assert.rejects(wordStructure(await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})),/decompressed size/);
  zip.file('word/'+ 'x'.repeat(210)+'.xml','x');await assert.rejects(wordStructure(await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})),/entry name/);
});

test('missing native renderers report capabilities and precise text fallback without producing fake images',async()=>{
  const f=await mediaFixtures(),conv=await db.conversation.create({data:{backend:'pi'}}),pdf=await db.attachment.create({data:await storeUpload(f.pdf,'fallback.pdf','application/pdf')}),image=await db.attachment.create({data:await storeUpload(f.image,'fallback.png','image/png')});
  for(const missing of ['@napi-rs/canvas','sharp']){
    const fault=registerHooks({resolve(s,c,next){if(s===missing)return{url:'data:text/javascript,throw new Error("synthetic missing '+missing+'");',shortCircuit:true};return next(s,c);}});
    try{
      const tools=buildAgentMediaTools(conv.id,null),index=await call(tools.inspectAttachment,{attachmentId:pdf.id});assert.equal(index.capabilities.pdfRendererAvailable,false);
      const result=await call(tools.readAttachmentVisual,{attachmentId:missing==='sharp'?image.id:pdf.id});assert.equal(result.ok,false);assert.equal(result.code,'renderer_unavailable');assert.equal(result.image,undefined);
      assert.equal((await call(tools.readDocumentPart,{attachmentId:pdf.id,partId:'page:1'})).ok,true);
    }finally{fault.deregister();}
  }
});

test('legacy Word VML image references and formatting revisions are surfaced without reading arbitrary package media',async()=>{
  const JSZip=(await import('jszip')).default,{wordStructure}=await import('../src/lib/docx-structure.ts'),f=await mediaFixtures(),zip=await JSZip.loadAsync(f.docx);
  let text=await zip.file('word/document.xml').async('string');
  text=text.replace('<w:body>','<w:body><w:p><w:r><w:rPr><w:rPrChange w:id="99" w:author="Editor"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:pict xmlns:v="urn:schemas-microsoft-com:vml"><v:shape><v:imagedata r:id="img1"/></v:shape></w:pict></w:r></w:p>');
  zip.file('word/document.xml',text);const result=await wordStructure(await zip.generateAsync({type:'nodebuffer'})),main=result.parts.find(p=>p.id==='word/document.xml').text;
  assert.ok(main.includes('format/table revision rPrChange id=99'));assert.equal(result.images.length,1);assert.ok(!result.images.some(i=>i.id.includes('unreferenced')));
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
