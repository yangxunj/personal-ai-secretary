import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openPiSession, CitationStream, configFingerprint } from '../src/lib/pi/runtime.mjs';

const cfg={baseUrl:'https://synthetic.invalid/v1',apiKey:'synthetic-key',model:'synthetic-model'};
const response=(text,promptTokens=40)=>new Response([
  {id:'test',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]},
  {id:'test',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:promptTokens,completion_tokens:10,total_tokens:promptTokens+10}},
].map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
test('actual SDK persists and resumes only its own context and exposes no built-in tools',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'secretary-pi-'));const payloads=[];
  const fetchImpl=async(input,init)=>{assert.equal(String(input),cfg.baseUrl+'/chat/completions');payloads.push(JSON.parse(init.body));return response('synthetic answer');};
  try{
    let run=await openPiSession({directory,cfg,instructions:'test',tools:[],fetchImpl});
    assert.deepEqual(run.session.getActiveToolNames(),[]);
    await run.session.prompt('Remember marker J7X9',{expandPromptTemplates:false});run.session.dispose();
    const first=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
    run=await openPiSession({directory,cfg:{...cfg,apiKey:'rotated-synthetic'},instructions:'updated instructions',tools:[],fetchImpl});
    await run.session.prompt('Recall marker',{expandPromptTemplates:false});run.session.dispose();
    assert.match(JSON.stringify(payloads[1].messages),/J7X9/);
    assert.match(JSON.stringify(payloads[1].messages),/updated instructions/);
    assert.equal(JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8')).sessionFile,first.sessionFile);
    assert.equal(payloads.length,2);
    await assert.rejects(openPiSession({directory,cfg:{...cfg,model:'changed'},instructions:'test',tools:[],fetchImpl}),/model changed/);
    assert.equal(configFingerprint(cfg),configFingerprint({...cfg,apiKey:'new'}));
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('actual SDK cancellation aborts the HTTP request without retrying',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'secretary-pi-abort-'));let started;const ready=new Promise(r=>started=r);let requests=0;
  const run=await openPiSession({directory,cfg,instructions:'test',tools:[],fetchImpl:async(_input,init)=>{
    requests++;started();return new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
  }});
  try{const work=run.session.prompt('wait');await ready;await run.session.abort();await work.catch(()=>{});assert.equal(requests,1);assert.equal(run.session.messages.at(-1).stopReason,'aborted');}
  finally{run.session.dispose();await rm(directory,{recursive:true,force:true});}
});
test('cancelling an initialized session before its first prompt leaves a resumable mapping',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'secretary-pi-empty-'));
  try{
    let run=await openPiSession({directory,cfg,instructions:'test',tools:[]});const file=run.manifest.sessionFile;
    await run.saveManifest({pendingTurn:'interrupted-before-prompt'});run.session.dispose();
    run=await openPiSession({directory,cfg,instructions:'test',tools:[],fetchImpl:async()=>response('resumed')});
    assert.equal(run.manifest.sessionFile,file);await run.session.prompt('A new request');run.session.dispose();
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('actual configured runtime automatically compacts and persists its summary',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'secretary-pi-compact-'));let requests=0;
  const run=await openPiSession({directory,cfg,instructions:'synthetic test',tools:[],contextWindow:8192,fetchImpl:async()=>{
    requests++;return response('Synthetic marker J7X9 summary',requests===2?7000:40);
  }});
  const events=[];run.session.subscribe(e=>{if(e.type.startsWith('compaction'))events.push(e);});
  try{
    await run.session.prompt('Remember marker J7X9. '+'synthetic '.repeat(700));
    await run.session.prompt('A later turn '+'synthetic '.repeat(500));
    await run.session.prompt('Another short later turn');
    assert.ok(run.manager.getEntries().some(entry=>entry.type==='compaction'),JSON.stringify({requests,events,messages:run.session.messages.map(m=>({role:m.role,usage:m.usage,stopReason:m.stopReason,error:m.errorMessage}))}));
    assert.ok(requests>=4);
  }finally{run.session.dispose();await rm(directory,{recursive:true,force:true});}
});
test('citations withstand every delta split, reject forged/old tokens and bound unfinished tokens',()=>{
  const value='Hello [[cite:valid]] end';
  for(let i=0;i<=value.length;i++){
    const stream=new CitationStream();stream.register('valid',{attachmentId:'file1',filename:'Report',locator:'page 1',url:'/api/files/file1',version:'v'});
    const output=stream.push(value.slice(0,i))+stream.push(value.slice(i))+stream.push('',true);
    assert.equal(output,'Hello [〔1〕](/api/files/file1) end');assert.match(stream.appendix(),/Report/);
  }
  const fresh=new CitationStream();assert.equal(fresh.push('[[cite:valid]]'),'（来源未核实）');
  assert.equal(fresh.push('[[cite:'+ 'x'.repeat(300)),'（来源未核实）');
  assert.equal(fresh.buffer.length,0);
});
