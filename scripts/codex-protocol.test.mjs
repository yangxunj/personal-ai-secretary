import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexConnection, runTurn, denyRequest, resolveExecutable } from '../src/lib/codex/protocol.mjs';

function fake(handler) {
  const proc=new EventEmitter();proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.kill=()=>{};
  let pending='';const received=[];
  const reply=msg=>proc.stdout.write(JSON.stringify(msg)+'\n');
  proc.stdin=new Writable({write(chunk,_encoding,callback){pending+=chunk.toString();while(pending.includes('\n')){const end=pending.indexOf('\n');const msg=JSON.parse(pending.slice(0,end));pending=pending.slice(end+1);received.push(msg);if(msg.method==='initialize')reply({id:msg.id,result:{}});else handler(msg,reply,proc);}callback();}});
  return {client:new CodexConnection({launcher:()=>proc}),received,proc};
}

test('experimental handshake and final reply even when completion precedes turn/start response',async()=>{
  const {client,received}=fake((msg,reply)=>{
    if(msg.method==='turn/start'){
      reply({method:'item/completed',params:{threadId:'thread-a',item:{type:'agentMessage',phase:'final_answer',text:'saved'}}});
      reply({method:'turn/completed',params:{threadId:'thread-a',turn:{id:'turn-a',status:'completed'}}});
      reply({id:msg.id,result:{turn:{id:'turn-a'}}});
    }
  });
  await client.connect();assert.equal(received[0].params.capabilities.experimentalApi,true);
  assert.equal(await runTurn(client,{threadId:'thread-a',input:[{type:'text',text:'hello'}],timeoutMs:100}), 'saved');
  client.close();
});
test('a failed turn cannot be presented as success',async()=>{
  const {client}=fake((msg,reply)=>{if(msg.method==='turn/start'){reply({id:msg.id,result:{turn:{id:'t'}}});setImmediate(()=>reply({method:'turn/completed',params:{threadId:'a',turn:{id:'t',status:'failed',error:{message:'allowance exhausted'}}}}));}});
  await client.connect();await assert.rejects(runTurn(client,{threadId:'a',input:[],timeoutMs:100}),/allowance exhausted/);client.close();
});
test('events from another thread do not finish this turn',async()=>{
  const {client}=fake((msg,reply)=>{if(msg.method==='turn/start'){reply({id:msg.id,result:{turn:{id:'t'}}});reply({method:'turn/completed',params:{threadId:'other',turn:{status:'completed'}}});}else if(msg.id)reply({id:msg.id,result:{}});});
  await client.connect();await assert.rejects(runTurn(client,{threadId:'a',input:[],timeoutMs:20}),/timed out/);client.close();
});
test('process loss fails an active turn promptly',async()=>{
  const {client}=fake((msg,reply,proc)=>{if(msg.method==='turn/start'){reply({id:msg.id,result:{turn:{id:'t'}}});setImmediate(()=>proc.emit('exit',1));}});
  await client.connect();await assert.rejects(runTurn(client,{threadId:'a',input:[],timeoutMs:100}),/process exited/);client.close();
});
test('shell, patch, permissions and unknown server requests are denied',async()=>{
  const {client,received}=fake(()=>{});await client.connect();
  denyRequest(client,{id:101,method:'item/commandExecution/requestApproval'});
  denyRequest(client,{id:102,method:'item/fileChange/requestApproval'});
  denyRequest(client,{id:103,method:'item/permissions/requestApproval'});
  denyRequest(client,{id:104,method:'other/tool'});
  assert.deepEqual(received.at(-4).result,{decision:'decline'});assert.deepEqual(received.at(-3).result,{decision:'decline'});assert.deepEqual(received.at(-2).result,{permissions:{}});assert.equal(received.at(-1).error.code,-32601);client.close();
});

test('Windows does not accept the extensionless npm shell shim', {skip:process.platform !== 'win32'}, async () => {
  const {mkdtemp,writeFile,unlink,rmdir}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'codex-shim-test-'));const shim=join(dir,'codex');
  try {await writeFile(shim,'#!/bin/sh');assert.throws(()=>resolveExecutable(shim),/executable not found/);}
  finally {await unlink(shim);await rmdir(dir);}
});
