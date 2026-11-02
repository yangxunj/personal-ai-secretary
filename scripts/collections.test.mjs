import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'secretary-collections-'));
process.env.DATABASE_URL='file:'+path.join(temp,'test.db').replaceAll('\\','/');
const baseline=fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8').replace(/^model Custom(?:CollectionVersion|Collection|Record) \{[^]*?^\}/gm,'');
const schema=path.join(temp,'baseline.prisma');fs.writeFileSync(schema,baseline);
execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate','--schema',schema],{cwd:root,env:process.env,stdio:'pipe',windowsHide:true});
const hooks=registerHooks({
  resolve(specifier,context,next){
    if(specifier==='next/cache')return{url:'data:text/javascript,export const revalidatePath=()=>{};',shortCircuit:true};
    let base;
    if(specifier.startsWith('@/'))base=path.join(root,'src',specifier.slice(2));
    else if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:'))base=path.resolve(path.dirname(fileURLToPath(context.parentURL)),specifier);
    if(base){const file=['','.ts','.tsx','.mjs','/index.ts'].map(ext=>base+ext).find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());if(file)return{url:pathToFileURL(file).href,shortCircuit:true};}
    return next(specifier,context);
  },
  load(url,context,next){if(url.startsWith('file:')&&/\.tsx?$/.test(url))return{format:'module',source:ts.transpileModule(fs.readFileSync(fileURLToPath(url),'utf8'),{fileName:fileURLToPath(url),compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText,shortCircuit:true};return next(url,context);},
});
const {db}=await import('../src/lib/db.ts');
const {upgradeSchema}=await import('../src/lib/schema-upgrade.ts');
const {validateValues,parseDefinition}=await import('../src/lib/collections/schema.ts');
const service=await import('../src/lib/collections/service.ts');
const {buildCollectionTools}=await import('../src/lib/collections/tools.ts');
const {getCodexToolVersion,codexToolProfileKey}=await import('../src/lib/codex/tool-profile.ts');
const {collectionTemplates}=await import('../src/lib/collections/templates.ts');
const {openPiSession}=await import('../src/lib/pi/runtime.mjs');
const {executeAgentTool}=await import('../src/lib/agent-turns.ts');
const {buildChatTools}=await import('../src/lib/task-chat-tools.ts');
const {z}=await import('zod');
const definition={title:'Synthetic records',description:'Test data',view:'table',titleFieldId:'name',fields:[{id:'name',label:'Name',type:'text',required:true},{id:'notes',label:'Notes',type:'longText',required:false},{id:'count',label:'Count',type:'number',required:false},{id:'date',label:'Date',type:'date',required:false},{id:'stage',label:'Stage',type:'select',options:['new','done'],required:false},{id:'flag',label:'Flag',type:'boolean',required:false}]};
const fail=code=>error=>error.code===code;
test.after(async()=>{await db.$disconnect();hooks.deregister();const resolved=path.resolve(temp);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('secretary-collections-'));fs.rmSync(resolved,{recursive:true,force:true});});
test('previous-release schema upgrades idempotently without changing existing task data',async()=>{
  await db.task.create({data:{id:'synthetic-old-task',title:'Original task',detail:'Keep requirements',result:'Keep result'}});
  assert.ok((await upgradeSchema()).includes('CustomCollections'));assert.deepEqual(await upgradeSchema(),[]);
  const task=await db.task.findUnique({where:{id:'synthetic-old-task'}});assert.equal(task.detail,'Keep requirements');assert.equal(task.result,'Keep result');
});
test('schema and values enforce stable keys, title contract, actual types, dates, options and bounds',()=>{
  assert.equal(parseDefinition(definition).fields.length,6);
  assert.throws(()=>parseDefinition({...definition,fields:[...definition.fields,definition.fields[0]]}),fail('definition'));
  assert.throws(()=>parseDefinition({...definition,titleFieldId:'notes'}),fail('definition'));
  for(const values of [{name:'A',count:'2'},{name:'A',date:'2026-02-30'},{name:'A',stage:'unexpected'},{name:'A',flag:'false'},{name:'A',unknown:2},{name:' '}])assert.throws(()=>validateValues(definition,values));
  assert.deepEqual(validateValues(definition,{name:' A ',count:0,flag:false,date:'2024-02-29'}),{name:'A',count:0,date:'2024-02-29',flag:false});
});
test('row patches preserve omitted values, reject stale versions and unknown fields, and page typed queries',async()=>{
  const c=await service.createCollection(definition);
  const first=await service.writeRecord(c.id,c.version,{name:'Alpha',notes:'Keep exact notes',count:1,stage:'new'});
  await service.writeRecord(c.id,c.version,{name:'Beta',count:2});
  const patched=await service.writeRecord(c.id,c.version,{count:3},first.record.id,first.record.version);
  assert.equal(patched.record.values.notes,'Keep exact notes');assert.equal(patched.record.values.count,3);
  await assert.rejects(service.writeRecord(c.id,c.version,{count:9},first.record.id,first.record.version),fail('conflict'));
  await assert.rejects(service.writeRecord(c.id,c.version,{unknown:'x'},patched.record.id,patched.record.version),fail('unknownField'));
  const page=await service.queryRecords(c.id,{limit:1});assert.equal(page.total,2);assert.equal(page.nextOffset,1);
  assert.equal((await service.queryRecords(c.id,{filters:[{fieldId:'count',op:'gte',value:3}]})).total,1);
  assert.equal((await service.queryRecords(c.id,{query:'Keep exact'})).total,1);
  await assert.rejects(service.queryRecords(c.id,{filters:[{fieldId:'name',op:'gte',value:'A'}]}),fail('filter'));
});
test('renaming field labels retains stable data; destructive changes, invalid required additions and stale schemas roll back',async()=>{
  const c=await service.createCollection(definition),row=await service.writeRecord(c.id,c.version,{name:'Keep me',notes:'Original text'});
  const next={...c.definition,fields:c.definition.fields.map(f=>({...f,label:'Renamed '+f.label}))};
  const updated=await service.updateCollection(c.id,c.version,next,true);
  assert.equal((await service.readRecord(c.id,row.record.id)).record.values.notes,'Original text');
  assert.equal(await db.customCollectionVersion.count({where:{collectionId:c.id}}),1);
  await assert.rejects(service.writeRecord(c.id,c.version,{name:'Stale schema'}),fail('conflict'));
  await assert.rejects(service.updateCollection(c.id,updated.version,{...next,fields:next.fields.filter(f=>f.id!=='notes')},true),fail('usedField'));
  await assert.rejects(service.updateCollection(c.id,updated.version,{...next,fields:[...next.fields,{id:'required_new',label:'New required',type:'text',required:true}]},true),fail('required'));
  assert.equal((await service.getCollection(c.id)).version,updated.version);
});
test('disabled collections and drafts are absent from discovery and cannot read/write; re-enable preserves records',async()=>{
  const c=await service.createCollection(definition),row=await service.writeRecord(c.id,c.version,{name:'Preserve'});
  const disabled=await service.setCollectionEnabled(c.id,c.version,false);
  assert.ok(!(await service.listCollections()).some(item=>item.id===c.id));
  await assert.rejects(service.queryRecords(c.id),fail('disabled'));await assert.rejects(service.readRecord(c.id,row.record.id),fail('disabled'));
  await assert.rejects(service.writeRecord(c.id,disabled.version,{name:'Forbidden'}),fail('disabled'));
  await assert.rejects(service.archiveRecord(c.id,row.record.id,row.record.version,true),fail('disabled'));
  const enabled=await service.setCollectionEnabled(c.id,disabled.version,true);assert.equal((await service.queryRecords(c.id)).total,1);
  const draft=await service.createCollection(definition,true);assert.equal(draft.enabled,false);await assert.rejects(service.queryRecords(draft.id),fail('disabled'));
  const confirmed=await service.updateCollection(draft.id,draft.version,draft.definition,true);assert.equal(confirmed.draft,false);assert.equal(confirmed.enabled,true);assert.ok(enabled.version>c.version);
});
test('references enforce target collection, existence, active status and disabled boundaries',async()=>{
  const parent=await service.createCollection(definition),other=await service.createCollection(definition);
  const p=await service.writeRecord(parent.id,parent.version,{name:'Parent'}),wrong=await service.writeRecord(other.id,other.version,{name:'Wrong parent'});
  const child=await service.createCollection({...definition,fields:[...definition.fields,{id:'parent',label:'Parent',type:'reference',required:true,targetCollectionId:parent.id}]});
  await assert.rejects(service.writeRecord(child.id,child.version,{name:'No target',parent:wrong.record.id}),fail('reference'));
  const log=await service.writeRecord(child.id,child.version,{name:'Log',parent:p.record.id});
  await assert.rejects(service.readRecord(other.id,log.record.id),fail('missing'));
  await service.archiveRecord(parent.id,p.record.id,p.record.version,true);
  await assert.rejects(service.writeRecord(child.id,child.version,{name:'Archived parent',parent:p.record.id}),fail('reference'));
  const restored=await service.archiveRecord(parent.id,p.record.id,p.record.version+1,false);assert.equal(restored.archived,false);
  await service.setCollectionEnabled(parent.id,parent.version,false);
  await assert.rejects(service.writeRecord(child.id,child.version,{name:'Disabled parent',parent:p.record.id}),fail('reference'));
});
test('generic tools use the same store, preserve fields and enforce disabled policy at execution time',async()=>{
  const c=await service.createCollection(definition),tools=buildCollectionTools(),options={toolCallId:'synthetic-call',messages:[]};
  const made=await tools.createCollectionRecord.execute({collectionId:c.id,schemaVersion:c.version,values:{name:'Tool-created',notes:'Preserve notes'}},options);
  assert.equal((await service.readRecord(c.id,made.record.id)).record.title,'Tool-created');
  await tools.updateCollectionRecord.execute({collectionId:c.id,schemaVersion:c.version,recordId:made.record.id,expectedVersion:made.record.version,values:{count:4}},options);
  assert.equal((await service.readRecord(c.id,made.record.id)).record.values.notes,'Preserve notes');
  await service.setCollectionEnabled(c.id,c.version,false);
  await assert.rejects(tools.queryCollectionRecords.execute({collectionId:c.id},options),fail('disabled'));
  const draft=await tools.proposeCollection.execute({definition},options);assert.equal(draft.draft,true);assert.match(draft.reviewUrl,/configure$/);
  assert.ok(!(await tools.listCollections.execute({},options)).collections.some(item=>item.id===draft.collectionId));
});
test('customer/pet templates are configurations over the same engine, including their linked log collections',async()=>{
  for(const template of collectionTemplates(text=>text)){
    const parent=await service.createCollection(template.parent);
    const child=await service.createCollection({...template.child,fields:template.child.fields.map(f=>f.type==='reference'?{...f,targetCollectionId:parent.id}:f)});
    const row=await service.writeRecord(parent.id,parent.version,{name:'Synthetic '+template.id});
    const log=await service.writeRecord(child.id,child.version,{name:'Synthetic log',parent:row.record.id,date:'2026-11-02'});
    assert.equal(log.record.values.parent,row.record.id);assert.equal((await service.queryRecords(child.id)).total,1);
  }
});
test('new Codex conversations get v4, while previous tool profiles retain their exact version and memory mapping',async()=>{
  assert.equal(await getCodexToolVersion('synthetic-new',null),4);
  for(const version of [1,2,3,4]){await db.setting.upsert({where:{key:codexToolProfileKey('synthetic-profile')},create:{key:codexToolProfileKey('synthetic-profile'),value:JSON.stringify({version,threadId:'thread-original'})},update:{value:JSON.stringify({version,threadId:'thread-original'})}});assert.equal(await getCodexToolVersion('synthetic-profile','thread-original'),version);assert.equal(await getCodexToolVersion('synthetic-profile','thread-other'),0);}
});
test('task-scoped and legacy Codex tool sets exclude collection tools; general tools discover columns without per-column registration',()=>{
  const base={incoming:[],conversationId:'synthetic-conversation'};
  assert.ok(buildChatTools(base).createCollectionRecord);
  assert.equal(buildChatTools({...base,collectionTools:false}).createCollectionRecord,undefined);
  assert.equal(buildChatTools({...base,taskId:'synthetic-task'}).createCollectionRecord,undefined);
});
test('actual Pi tool loop reads schema, writes and patches shared records through durable audited transactions',async()=>{
  const c=await service.createCollection(definition),conv=await db.conversation.create({data:{backend:'pi'}});
  const turn=await db.codexTurn.create({data:{conversationId:conv.id,requestKey:'synthetic-collection-loop',inputHash:'synthetic',processKey:'test',status:'completed'}});
  const defs=buildCollectionTools(),signal=new AbortController().signal,receipts=new Map();
  const tools=Object.entries(defs).map(([name,def])=>({name,label:name,description:def.description,parameters:z.toJSONSchema(def.inputSchema,{io:'input'}),execute:async(callId,args)=>{
    const result=await executeAgentTool({turnId:turn.id,callId,name,args,def,signal});receipts.set(name,result);
    return{content:[{type:'text',text:JSON.stringify(result)}],details:{}};
  }}));
  let requests=0;
  const fetchImpl=async(_url,init)=>{
    const payload=JSON.parse(init.body);requests++;
    let delta,finish;
    const created=receipts.get('createCollectionRecord');
    if(requests<=3){
      const name=requests===1?'describeCollection':requests===2?'createCollectionRecord':'updateCollectionRecord';
      const args=requests===1?{collectionId:c.id}:requests===2?{collectionId:c.id,schemaVersion:c.version,values:{name:'Pi shared record',notes:'Keep original notes'}}:{collectionId:c.id,recordId:created.record.id,expectedVersion:created.record.version,schemaVersion:c.version,values:{count:8}};
      assert.ok(payload.tools.some(tool=>tool.function.name===name));
      delta={role:'assistant',tool_calls:[{index:0,id:'collection-call-'+requests,type:'function',function:{name,arguments:JSON.stringify(args)}}]};finish='tool_calls';
    }else{delta={role:'assistant',content:'Synthetic collection update complete.'};finish='stop';}
    return new Response([{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}].map(item=>'data: '+JSON.stringify(item)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  const run=await openPiSession({directory:path.join(temp,'pi-session'),cfg:{baseUrl:'https://synthetic.invalid/v1',apiKey:'synthetic-only',model:'synthetic'},instructions:'Use only platform tools for the requested synthetic record.',tools,fetchImpl});
  try{await run.session.prompt('Read the definition, create a record, and update its count only.');}finally{run.session.dispose();}
  assert.equal(requests,4);
  const record=(await service.queryRecords(c.id)).records[0];assert.equal(record.values.notes,'Keep original notes');assert.equal(record.values.count,8);
  assert.equal(await db.codexToolRun.count({where:{turnId:turn.id,status:'completed'}}),3);
  const created=receipts.get('createCollectionRecord');
  const replay=await executeAgentTool({turnId:turn.id,callId:'collection-call-2',name:'createCollectionRecord',args:{collectionId:c.id,schemaVersion:c.version,values:{name:'Pi shared record',notes:'Keep original notes'}},def:defs.createCollectionRecord,signal});
  assert.equal(replay.record.id,created.record.id);assert.equal((await service.queryRecords(c.id)).total,1);
});
test('the pilot record cap is enforced, queries paginate its boundary and tool previews do not dump full rows',async()=>{
  const c=await service.createCollection(definition);
  await db.customRecord.createMany({data:Array.from({length:2000},(_,i)=>({id:'cap-record-'+i,collectionId:c.id,title:'Row '+i,data:JSON.stringify({name:'Row '+i,notes:'x'.repeat(1000)}),searchText:'Row '+i}))});
  await assert.rejects(service.writeRecord(c.id,c.version,{name:'Too many'}),fail('limit'));
  const tail=await service.queryRecords(c.id,{offset:1999,limit:50});assert.equal(tail.records.length,1);assert.equal(tail.nextOffset,null);
  const tools=buildCollectionTools(),preview=await tools.queryCollectionRecords.execute({collectionId:c.id,limit:1},{toolCallId:'preview',messages:[]});
  assert.equal(preview.records[0].values,undefined);assert.equal(preview.records[0].truncated,true);assert.equal(preview.records[0].preview.length,600);
});
