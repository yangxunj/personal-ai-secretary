import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

const moduleUrl = (file, imports = {}) => {
  let source = readFileSync(new URL(file, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(imports)) source = source.replaceAll(`'${from}'`, JSON.stringify(to));
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
};
const mockModule = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const protocolUrl = moduleUrl('../src/lib/realtime/protocol.ts');
const transportUrl = moduleUrl('../src/lib/realtime/transport.ts');
const { ResponseGate, sessionConfiguration } = await import(protocolUrl);
const { PcmResampler, decodePcm16 } = await import(moduleUrl('../src/lib/realtime/audio.ts'));

test('PCM resampling preserves phase across 20ms boundaries at browser sample rates', () => {
  for (const rate of [16000, 44100, 48000]) {
    const input = Float32Array.from({ length: rate * 2 }, (_, i) => Math.sin(i / 10) * .6);
    const reference = [...new PcmResampler(rate).push(input)], stream = new PcmResampler(rate), actual = [];
    for (let i = 0; i < input.length; i += rate * .02) actual.push(...stream.push(input.slice(i, i + rate * .02)));
    assert.deepEqual(actual, reference); assert.ok(Math.abs(actual.length - 32000) <= 1);
  }
});
test('PCM output decodes signed little endian and rejects malformed packets', () => {
  assert.deepEqual([...decodePcm16(Buffer.from([0,0,255,127,0,128]).toString('base64'))], [0,32767/32768,-1]);
  assert.throws(() => decodePcm16('AA=='));
});
test('interruption suppresses old audio without freeing an occupied provider response slot', () => {
  const gate = new ResponseGate(); gate.active.add('old'); gate.playing.add('old'); gate.interrupt();
  assert.ok(gate.blocked); assert.ok(gate.suppressed.has('old')); assert.equal(gate.playing.size, 0);
  gate.speaking=false;gate.pending=false;assert.ok(gate.blocked);
  gate.active.delete('old');assert.equal(gate.blocked,false);
  for (const model of ['qwen-audio-3.0-realtime-flash', 'qwen-audio-3.0-realtime-plus']) {
    const config=sessionConfiguration(model,'longanqian','test');
    assert.equal(config.turn_detection.type,'server_vad');
    assert.equal(config.turn_detection.silence_duration_ms,1200);
    assert.equal(config.tools[0].name,'submit_agent_request');
  }
});

const shared = globalThis.__rtMock = {};
const dbUrl=mockModule('export const db=globalThis.__rtMock.db;');
const runUrl=mockModule('export const runChat=(...args)=>globalThis.__rtMock.runChat(...args);');
const stateUrl=moduleUrl('../src/lib/realtime/job-state.ts',{'@/lib/db':dbUrl});
const jobsUrl=moduleUrl('../src/lib/realtime/jobs.ts',{'@/lib/db':dbUrl,'@/lib/chat-agent':runUrl,'./job-state':stateUrl});
const jobs = new Map();
shared.db={voiceJob:{
  updateMany:async({where,data})=>{for(const job of jobs.values())if(where.status?.in.includes(job.status)&&job.processKey!==where.processKey.not)Object.assign(job,data);},
  findUnique:async({where})=>[...jobs.values()].find(job=>job.requestKey===where.requestKey)||null,
  count:async({where})=>[...jobs.values()].filter(job=>job.conversationId===where.conversationId&&where.status.in.includes(job.status)).length,
  create:async({data})=>{if([...jobs.values()].some(job=>job.requestKey===data.requestKey))throw new Error('Unique');const job={id:`job${jobs.size}`,status:'queued',result:null,error:null,...data};jobs.set(job.id,job);return {...job};},
  update:async({where,data})=>{const job=jobs.get(where.id);Object.assign(job,data);return {...job};},
}};
const { consumeAgentResponse, submitVoiceJob } = await import(jobsUrl);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const streamResponse = (text='完成') => new Response(`data: ${JSON.stringify({type:'reasoning-delta',delta:'private'})}\n\ndata: ${JSON.stringify({type:'text-delta',delta:text})}\n\ndata: ${JSON.stringify({type:'finish',finishReason:'stop'})}\n\ndata: [DONE]\n\n`);
test('Agent result consumes full SSE and excludes reasoning, rejecting incomplete or failed streams', async()=>{
  assert.equal(await consumeAgentResponse(streamResponse()),'完成');
  await assert.rejects(consumeAgentResponse(new Response('data: {"type":"error","errorText":"failed"}\n\n')));
  await assert.rejects(consumeAgentResponse(new Response('data: {"type":"text-delta","delta":"partial"}\n\n')));
});
test('accepted work is nonblocking, deduplicated and FIFO within one conversation', async()=>{
  const started=[],finished=[],releases=[];
  shared.runChat=async(req)=>{const data=await req.json();started.push(data.message.parts[0].text);await new Promise(resolve=>releases.push(resolve));return streamResponse('真实结果');};
  const input={conversationId:'test',taskId:null,requestKey:'test:turn1',transcript:'原始说法',objective:'第一件事',locale:'zh',t:x=>x};
  const first=await submitVoiceJob(input,job=>finished.push(job));
  const duplicate=await submitVoiceJob(input,job=>finished.push(job));assert.equal(first.id,duplicate.id);
  await submitVoiceJob({...input,requestKey:'test:turn2',objective:'第二件事'},job=>finished.push(job));
  await tick();assert.equal(started.length,1);assert.ok(started[0].includes('第一件事'));assert.ok(started[0].includes('原始说法'));assert.equal(finished.length,0);
  releases.shift()();await tick();await tick();assert.equal(started.length,2);assert.ok(started[1].includes('第二件事'));
  releases.shift()();await tick();await tick();assert.equal(finished.length,2);assert.ok(finished.every(job=>job.status==='completed'));
});

class Socket extends EventEmitter {
  static OPEN=1;readyState=1;bufferedAmount=0;sent=[];
  constructor(){super();shared.socket=this;}
  send(data){this.sent.push(JSON.parse(data));}
  close(){this.emit('close');}
  server(event){this.emit('message',Buffer.from(JSON.stringify(event)));}
}
const socketUrl=mockModule('export default globalThis.__rtMock.Socket;');
shared.Socket=Socket;
const sessionDb={message:{findMany:async()=>[]},voiceJob:{findMany:async()=>shared.recoveredResults||[],updateMany:async(...args)=>shared.announced.push(args)}};
const sessionDbUrl=mockModule('export const db=globalThis.__rtMock.sessionDb;');shared.sessionDb=sessionDb;
const sessionJobsUrl=mockModule('export const voiceJobStatus=async()=>[];export const submitVoiceJob=(...args)=>globalThis.__rtMock.submit(...args);');
const sessionUrl=moduleUrl('../src/lib/realtime/session.ts',{'ws':socketUrl,'@/lib/db':sessionDbUrl,'./jobs':sessionJobsUrl,'./protocol':protocolUrl,'./transport':transportUrl});
const { RealtimeSession }=await import(sessionUrl);
test('a lost upload acknowledgment can retry the same bounded packet without duplicating upstream audio',async()=>{
  const session=new RealtimeSession({owner:'test',conversationId:'retry-audio',taskId:null,locale:'zh',t:x=>x,
    config:{apiKey:'test',endpoint:'wss://example.test',model:'qwen-audio-3.0-realtime-flash',voice:'longanqian'}},()=>{});
  session.attach(()=>{});await tick();const socket=shared.socket;socket.emit('open');socket.server({type:'session.updated'});await tick();
  const packet=new Uint8Array(64000);session.audio(packet,0);session.audio(packet,0);
  assert.equal(socket.sent.filter(event=>event.type==='input_audio_buffer.append').length,1);
  assert.throws(()=>session.audio(new Uint8Array(64002),1));
  session.audio(new Uint8Array(5120),1);
  session.audio(packet,0);
  assert.equal(socket.sent.filter(event=>event.type==='input_audio_buffer.append').length,2);
  for(const sequence of [NaN,-1,0.5,3])assert.throws(()=>session.audio(new Uint8Array(5120),sequence));
  session.close();
});

test('brief upload gaps retain the voice session, while abandoned microphones are still cleaned up',async(context)=>{
  context.mock.timers.enable({apis:['setInterval','Date'],now:Date.now()});
  const events=[];
  const session=new RealtimeSession({owner:'test',conversationId:'upload-gap',taskId:null,locale:'zh',t:x=>x,
    config:{apiKey:'test',endpoint:'wss://example.test',model:'qwen-audio-3.0-realtime-flash',voice:'longanqian'}},()=>{});
  session.attach(event=>events.push(event));await tick();shared.socket.emit('open');shared.socket.server({type:'session.updated'});await tick();
  context.mock.timers.tick(15000);await tick();assert.ok(!events.some(event=>event.type==='closed'));
  session.audio(new Uint8Array(5120),0);
  context.mock.timers.tick(20000);await tick();assert.ok(!events.some(event=>event.type==='closed'));
  context.mock.timers.tick(15000);await tick();assert.ok(events.some(event=>event.type==='closed'));
  session.close();context.mock.timers.reset();
});

test('speech during generation clears playback, cancels only the old response and accepts a later turn',async()=>{
  const events=[];let submitted=0;
  shared.submit=async()=>{submitted++;};
  const session=new RealtimeSession({owner:'test',conversationId:'barge-in',taskId:null,locale:'zh',t:x=>x,
    config:{apiKey:'test',endpoint:'wss://example.test',model:'qwen-audio-3.0-realtime-flash',voice:'longanqian'}},()=>{});
  session.attach(event=>events.push(event));await tick();const socket=shared.socket;socket.emit('open');socket.server({type:'session.updated'});await tick();
  socket.server({type:'response.created',response:{id:'old'}});
  socket.server({type:'response.audio.delta',response_id:'old',delta:'AAAA'});
  const boundary=events.length;
  socket.server({type:'input_audio_buffer.speech_started',item_id:'interruption'});
  assert.ok(events.slice(boundary).some(event=>event.type==='clear'));
  assert.ok(socket.sent.some(event=>event.type==='response.cancel'));
  socket.server({type:'response.audio.delta',response_id:'old',delta:'AAAA'});
  socket.server({type:'response.audio_transcript.delta',response_id:'old',delta:'stale'});
  assert.ok(!events.slice(boundary).some(event=>event.type==='audio'||event.role==='assistant'));
  socket.server({type:'response.done',response:{id:'old',status:'cancelled'}});
  // 上游通常也会自行取消旧回答；重复取消产生的可恢复错误不能关闭语音会话。
  socket.server({type:'error',error:{message:'Cancellation failed: no active response found'}});
  socket.server({type:'input_audio_buffer.speech_stopped',item_id:'interruption'});
  socket.server({type:'conversation.item.input_audio_transcription.completed',item_id:'interruption',transcript:'换一个话题'});
  socket.server({type:'response.created',response:{id:'new'}});
  socket.server({type:'response.audio.delta',response_id:'new',delta:'AAAA'});
  session.audio(new Uint8Array(5120),0);
  assert.ok(events.some(event=>event.type==='transcript'&&event.text==='换一个话题'));
  assert.ok(events.some(event=>event.type==='audio'&&event.responseId==='new'));
  assert.ok(!events.some(event=>event.type==='closed'||event.type==='error'));
  assert.equal(submitted,0);
  session.close();
});

test('duplex session queues real results through interruption and confirms actual playback',async()=>{
  const events=[],accepted=[];shared.announced=[];let complete;
  shared.submit=async(input,callback)=>{accepted.push(input);complete=callback;return {id:'work1',status:'queued',transcript:input.transcript};};
  const session=new RealtimeSession({owner:'test',conversationId:'conv',taskId:'bound-task',locale:'zh',t:x=>x,config:{apiKey:'synthetic-secret',endpoint:'wss://example.test',model:'qwen-audio-3.0-realtime-plus',voice:'longanqian'}},()=>{});
  session.attach(event=>events.push(event));await tick();const socket=shared.socket;socket.emit('open');
  socket.server({type:'session.updated'});await tick();
  session.audio(new Uint8Array(5120),0);session.audio(new Uint8Array(5120),0);
  assert.equal(socket.sent.filter(event=>event.type==='input_audio_buffer.append').length,1);
  socket.server({type:'input_audio_buffer.speech_started',item_id:'input1'});
  socket.server({type:'input_audio_buffer.speech_stopped',item_id:'input1'});
  socket.server({type:'conversation.item.input_audio_transcription.completed',item_id:'input1',transcript:'请创建测试待办'});
  socket.server({type:'response.created',response:{id:'r1'}});
  const call={type:'response.function_call_arguments.done',response_id:'r1',call_id:'call1',name:'submit_agent_request',arguments:'{"objective":"创建测试待办"}'};
  socket.server(call);socket.server(call);await tick();assert.equal(accepted.length,1);assert.equal(accepted[0].taskId,'bound-task');
  assert.equal(socket.sent.filter(e=>e.type==='response.create').length,0,'wait for upstream response.done');
  socket.server({type:'response.done',response:{id:'r1',status:'completed'}});await tick();
  assert.ok(socket.sent.some(e=>e.item?.type==='function_call_output'));
  socket.server({type:'response.created',response:{id:'receipt'}});
  socket.server({type:'response.audio.delta',response_id:'receipt',delta:'AAAA'});
  socket.server({type:'response.done',response:{id:'receipt',status:'completed'}});
  socket.server({type:'input_audio_buffer.speech_started',item_id:'input2'});
  const audioCount=events.filter(e=>e.type==='audio').length;
  socket.server({type:'response.audio.delta',response_id:'receipt',delta:'AAAA'});
  assert.equal(events.filter(e=>e.type==='audio').length,audioCount,'late audio discarded');
  complete({id:'work1',status:'completed',result:'已创建',error:null});
  const count=socket.sent.filter(e=>e.type==='response.create').length;
  assert.equal(shared.announced.length,0);
  socket.server({type:'input_audio_buffer.speech_stopped',reason:'turn_invalid'});await tick();
  assert.equal(socket.sent.filter(e=>e.type==='response.create').length,count+1);
  socket.server({type:'response.created',response:{id:'result'}});
  socket.server({type:'response.audio.delta',response_id:'result',delta:'AAAA'});
  assert.equal(shared.announced.length,0,'generation is not playback');
  session.control({type:'playback.started',responseId:'result'});await tick();assert.equal(shared.announced.length,1);
  session.close();complete({id:'late',status:'completed',result:'late',error:null});
  const after=events.length;socket.server({type:'response.audio.delta',response_id:'result',delta:'AAAA'});assert.equal(events.length,after);
  assert.ok(!JSON.stringify(events).includes('synthetic-secret'));
});

test('a tool call may finish before final ASR; execution waits for its matching transcript',async()=>{
  const accepted=[];shared.submit=async(input)=>{accepted.push(input);return {id:'delayed-job',status:'queued',transcript:input.transcript};};
  const session=new RealtimeSession({owner:'test',conversationId:'late-asr',taskId:null,locale:'zh',t:x=>x,config:{apiKey:'test',endpoint:'wss://example.test',model:'qwen-audio-3.0-realtime-plus',voice:'longanqian'}},()=>{});
  session.attach(()=>{});await tick();const socket=shared.socket;socket.emit('open');socket.server({type:'session.updated'});await tick();
  socket.server({type:'input_audio_buffer.speech_started',item_id:'late-input'});
  socket.server({type:'input_audio_buffer.speech_stopped',item_id:'late-input'});
  socket.server({type:'response.created',response:{id:'late-response'}});
  socket.server({type:'response.function_call_arguments.done',response_id:'late-response',call_id:'late-call',name:'submit_agent_request',arguments:'{"objective":"创建测试待办"}'});
  socket.server({type:'response.done',response:{id:'late-response',status:'completed'}});
  await tick();assert.equal(accepted.length,0);
  socket.server({type:'conversation.item.input_audio_transcription.completed',item_id:'late-input',transcript:'原始测试请求'});
  await tick();assert.equal(accepted.length,1);assert.equal(accepted[0].transcript,'原始测试请求');
  session.close();
});

test('closing during late ASR cannot create background work',async()=>{
  let submitted=0;shared.submit=async()=>{submitted++;};
  const session=new RealtimeSession({owner:'test',conversationId:'closed',taskId:null,locale:'zh',t:x=>x,config:{apiKey:'test',endpoint:'wss://example.test',model:'qwen-audio-3.0-realtime-plus',voice:'longanqian'}},()=>{});
  session.attach(()=>{});await tick();const socket=shared.socket;socket.emit('open');socket.server({type:'session.updated'});await tick();
  socket.server({type:'input_audio_buffer.speech_started',item_id:'closing'});socket.server({type:'input_audio_buffer.speech_stopped'});
  socket.server({type:'response.created',response:{id:'closing-r'}});
  socket.server({type:'response.function_call_arguments.done',response_id:'closing-r',call_id:'closing-call',name:'submit_agent_request',arguments:'{"objective":"创建测试待办"}'});
  session.close();socket.server({type:'conversation.item.input_audio_transcription.completed',item_id:'closing',transcript:'late'});
  await tick();assert.equal(submitted,0);
});

test('a reconnected session discovers later completion without reexecuting the job',async(context)=>{
  context.mock.timers.enable({apis:['setInterval']});shared.recoveredResults=[];
  const events=[];let submitted=0;shared.submit=async()=>{submitted++};
  const session=new RealtimeSession({owner:'test',conversationId:'reconnected',taskId:null,locale:'zh',t:x=>x,config:{apiKey:'test',endpoint:'wss://example.test',model:'qwen-audio-3.0-realtime-plus',voice:'longanqian'}},()=>{});
  session.attach(event=>events.push(event));await tick();const socket=shared.socket;socket.emit('open');socket.server({type:'session.updated'});await tick();
  shared.recoveredResults=[{id:'existing-work',status:'completed',result:'真实结果',error:null}];
  context.mock.timers.tick(5000);await tick();
  assert.ok(events.some(event=>event.type==='job'&&event.job.id==='existing-work'));assert.equal(submitted,0);
  assert.equal(socket.sent.filter(event=>event.type==='response.create').length,1);
  context.mock.timers.tick(5000);await tick();assert.equal(socket.sent.filter(event=>event.type==='response.create').length,1);
  session.close();shared.recoveredResults=[];context.mock.timers.reset();
});
