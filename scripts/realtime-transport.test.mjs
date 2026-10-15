import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../src/lib/realtime/transport.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText;
const {PcmUploadQueue,sendRealtimePacket,AUDIO_PACKET_MAX_SAMPLES,AUDIO_BUFFER_MAX_SAMPLES}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};

test('a six-second upload stall preserves every sample and drains bounded packets in order',async()=>{
  const sent=[],releases=[],warnings=[],errors=[];
  const queue=new PcmUploadQueue({send:(packet,sequence)=>{sent.push({packet,sequence});const pending=deferred();releases.push(pending);return pending.promise},onCongestion:value=>warnings.push(value),onError:reason=>errors.push(reason)});
  const expected=Int16Array.from({length:16000*6},(_,i)=>i%30000);
  for(let at=0;at<expected.length;at+=320)queue.push(expected.slice(at,at+320));
  assert.equal(sent.length,1,'only one audio upload may be in flight');assert.deepEqual(errors,[]);assert.deepEqual(warnings,[true]);
  for(let i=0;releases.length&&i<20;i++){releases.shift().resolve();await tick()}
  assert.ok(sent.every(({packet})=>packet.length<=AUDIO_PACKET_MAX_SAMPLES));
  assert.deepEqual(sent.map(({sequence})=>sequence),sent.map((_,i)=>i));
  assert.deepEqual(sent.flatMap(({packet})=>[...packet]),[...expected]);
  assert.deepEqual(warnings,[true,false]);assert.deepEqual(errors,[]);queue.stop();
});

test('sustained congestion stops at a bounded memory limit without dropping or replaying buffered speech',async()=>{
  const pending=deferred(),errors=[];let sent=0;
  const queue=new PcmUploadQueue({send:()=>{sent++;return pending.promise},onCongestion:()=>{},onError:reason=>errors.push(reason)});
  for(let at=0;at<=AUDIO_BUFFER_MAX_SAMPLES+640;at+=320)queue.push(new Int16Array(320));
  assert.deepEqual(errors,['overflow']);pending.resolve();await tick();queue.push(new Int16Array(3200));
  assert.equal(sent,1);assert.deepEqual(errors,['overflow']);
});

test('manual stop discards queued microphone data and ignores a late failed upload',async()=>{
  const pending=deferred(),errors=[];let sent=0;
  const queue=new PcmUploadQueue({send:()=>{sent++;return pending.promise},onCongestion:()=>{},onError:reason=>errors.push(reason)});
  queue.push(new Int16Array(3200));queue.push(new Int16Array(16000));queue.stop();pending.reject(new Error('Late failure'));await tick();
  queue.push(new Int16Array(3200));assert.equal(sent,1);assert.deepEqual(errors,[]);
});

test('temporary network/server failures retry exactly the original PCM packet and sequence',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});const requests=[];
  context.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,options});if(requests.length===1)throw new TypeError('Network reset');return new Response(null,{status:requests.length===2?503:204})});
  const packet=new Int16Array([1,2,3]).buffer,signal=new AbortController().signal;
  const result=sendRealtimePacket('/api/realtime?id=test&sequence=7',packet,signal);
  await tick();context.mock.timers.tick(250);await tick();context.mock.timers.tick(500);await result;
  assert.equal(requests.length,3);assert.ok(requests.every(request=>request.url.endsWith('sequence=7')&&request.options.body===packet));
  context.mock.timers.reset();
});

test('authorization and expired sessions fail promptly instead of retrying or creating sessions',async context=>{
  let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:401})});
  await assert.rejects(sendRealtimePacket('/api/realtime?id=expired','{}',new AbortController().signal));assert.equal(calls,1);
});

test('a redirected login page is not accepted as an audio acknowledgment',async context=>{
  let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}})});
  await assert.rejects(sendRealtimePacket('/api/realtime?id=expired',new ArrayBuffer(2),new AbortController().signal));assert.equal(calls,1);
});

test('retrying playback acknowledgments preserves the exact idempotent control message',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});const requests=[];
  context.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,options});return new Response(null,{status:requests.length===1?429:204})});
  const body=JSON.stringify({type:'playback.ended',responseId:'answer'}),pending=sendRealtimePacket('/api/realtime?id=test',body,new AbortController().signal);
  await tick();context.mock.timers.tick(250);await pending;
  assert.equal(requests.length,2);assert.ok(requests.every(request=>request.options.method==='PATCH'&&request.options.body===body));context.mock.timers.reset();
});

test('ending a session during retry backoff cancels all future uploads',async context=>{
  const abort=new AbortController();let calls=0;
  context.mock.method(globalThis,'fetch',async()=>{calls++;throw new TypeError('Offline')});
  const pending=sendRealtimePacket('/api/realtime?id=test',new ArrayBuffer(2),abort.signal);
  await tick();abort.abort();await assert.rejects(pending);await tick();assert.equal(calls,1);
});

test('persistent server failure exhausts a bounded retry budget',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});let calls=0;
  context.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:503})});
  const rejected=assert.rejects(sendRealtimePacket('/api/realtime?id=test',new ArrayBuffer(2),new AbortController().signal));
  await tick();context.mock.timers.tick(250);await tick();context.mock.timers.tick(500);await rejected;
  assert.equal(calls,3);context.mock.timers.reset();
});
