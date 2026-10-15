import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const mock = globalThis.__realtimeRoute = { auth: true, key: 'synthetic-key', sessions: new Map(), created: 0 };
const data = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const imports = {
  '@/lib/auth': data('export const SESSION_COOKIE="test"; export const sessionIsCurrent=async()=>globalThis.__realtimeRoute.auth;'),
  'next/headers': data('export const cookies=async()=>({get:()=>({value:"synthetic-session"})});'),
  '@/lib/i18n/server': data('export const getT=async()=>x=>x;export const getLocale=async()=>"zh";'),
  '@/lib/db': data('export const db={conversation:{upsert:async({where})=>({id:where.id,taskId:null})},codexTurn:{findFirst:async()=>null}};'),
  '@/lib/codex/config': data('export const getChatBackend=async()=>"api";'),
  '@/lib/realtime/config': data('export const validRealtimeConfig=()=>true;export const loadRealtimeConfig=async()=>({apiKey:globalThis.__realtimeRoute.key});'),
  '@/lib/realtime/session': data('export const realtimeSessions=globalThis.__realtimeRoute.sessions;export const createRealtimeSession=()=>{globalThis.__realtimeRoute.created++;return{id:"synthetic-id"}};'),
  '@/lib/realtime/transport': data('export const AUDIO_PACKET_MAX_SAMPLES=32000;'),
};
let source=readFileSync(new URL('../src/app/api/realtime/route.ts',import.meta.url),'utf8');
for(const [from,to]of Object.entries(imports))source=source.replaceAll(`'${from}'`,JSON.stringify(to));
const route=await import(data(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText));
const request=(method,body,headers={})=>new Request('http://localhost:3000/api/realtime?id=test&sequence=0',{method,headers:{'Content-Type':'application/json',...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
test('realtime endpoints enforce current login and reject cross-origin input before creating sessions',async()=>{
  mock.auth=false;
  for(const method of ['POST','GET','PATCH','DELETE'])assert.equal((await route[method](request(method))).status,401);
  mock.auth=true;assert.equal((await route.POST(request('POST',{conversationId:'a'.repeat(24)},{Origin:'https://foreign.example'}))).status,401);
  assert.equal(mock.created,0);
});
test('missing configuration, invalid scope and oversized bodies never open upstream sessions',async()=>{
  mock.key='';assert.equal((await route.POST(request('POST',{conversationId:'a'.repeat(24)}))).status,503);
  mock.key='synthetic-key';assert.equal((await route.POST(request('POST',{conversationId:'a'.repeat(24),taskId:'other-task'}))).status,409);
  assert.equal((await route.POST(request('POST','x'.repeat(16001)))).status,400);assert.equal(mock.created,0);
  const result=await route.POST(request('POST',{conversationId:'a'.repeat(24)}));assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{id:'synthetic-id'});assert.equal(mock.created,1);
});
test('a session capability remains bound to its authenticated owner',async()=>{
  mock.sessions.set('test',{options:{owner:'another-owner'}});
  for(const method of ['GET','PATCH','DELETE'])assert.equal((await route[method](request(method))).status,404);
  mock.sessions.delete('test');
});
test('invalid audio ends only the owned session, while valid audio never returns provider credentials',async()=>{
  let closed=0,packets=0;
  const owner=createHash('sha256').update('synthetic-session').digest('hex');
  mock.sessions.set('test',{options:{owner},audio:()=>{packets++},close:()=>closed++});
  const result=await route.PATCH(request('PATCH','ab',{'Content-Type':'application/octet-stream'}));assert.equal(result.status,204);assert.equal(packets,1);
  mock.sessions.get('test').audio=()=>{throw new Error('Invalid audio')};
  assert.equal((await route.PATCH(request('PATCH','ab',{'Content-Type':'application/octet-stream'}))).status,400);assert.equal(closed,1);
  mock.sessions.delete('test');
});
test('catch-up audio remains bounded and network-aborted uploads preserve the owned session for retry',async()=>{
  const owner=createHash('sha256').update('synthetic-session').digest('hex');let closed=0,packets=0;
  mock.sessions.set('test',{options:{owner},audio:()=>packets++,close:()=>closed++});
  assert.equal((await route.PATCH(request('PATCH','a'.repeat(64000),{'Content-Type':'application/octet-stream'}))).status,204);
  assert.equal(packets,1);
  const abort=new AbortController();
  const body=new ReadableStream({start(controller){abort.abort();controller.error(new Error('Connection reset'));}});
  const interrupted=new Request('http://localhost/api/realtime?id=test&sequence=1',{method:'PATCH',headers:{'Content-Type':'application/octet-stream'},body,signal:abort.signal,duplex:'half'});
  assert.equal((await route.PATCH(interrupted)).status,408);assert.equal(closed,0);assert.equal(packets,1);
  assert.equal((await route.PATCH(request('PATCH','a'.repeat(64002),{'Content-Type':'application/octet-stream'}))).status,400);
  assert.equal(closed,1);mock.sessions.delete('test');
});
