import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'data/chat-display-tests',Date.now().toString());
await fs.mkdir(dir,{recursive:true});process.env.DATABASE_URL='file:'+path.join(dir,'test.db').replaceAll('\\','/');
execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate'],{stdio:'pipe',env:process.env});
const state=globalThis.__displayTest={authorized:true,generate:async()=>({text:'Generated title'}),calls:[]};
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const mocks={
  '@/lib/auth':data('export const sessionIsCurrent=async()=>globalThis.__displayTest.authorized;'),
  '@/lib/i18n/server':data("export const getLocale=async()=>'en';export const getT=async()=>s=>s;"),
  '@/lib/ai-config':data("export const getAiConfig=async()=>({baseUrl:'http://127.0.0.1/v1',apiKey:'synthetic',model:'synthetic'});"),
  '@/lib/pi/storage':data("export const piDirectory=id=>'unused-test-directory/'+id;"),
  ai:data('export const generateText=options=>{globalThis.__displayTest.calls.push(options);return globalThis.__displayTest.generate(options);};'),
};
const hooks=registerHooks({resolve(s,c,next){
  if(mocks[s])return{url:mocks[s],shortCircuit:true};
  if(s.startsWith('@/')){const base=path.join(root,'src',s.slice(2));return{url:pathToFileURL(['.ts','/index.ts'].map(e=>base+e).find(existsSync)).href,shortCircuit:true};}
  return next(s,c);
},load(url,c,next){if(url.startsWith('file:')&&url.endsWith('.ts')&&!url.includes('/node_modules/'))return{format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,c);}});
const {db}=await import('../src/lib/db.ts');
const {displayPage,parseDisplayCursor}=await import('../src/lib/chat-display-history.ts');
const {mergeDisplayMessages,displayCursor}=await import('../src/components/chat/history-state.ts');
const {autoTitle}=await import('../src/lib/conversations.ts');
const {GET}=await import('../src/app/api/chat/history/route.ts');
test.after(async()=>{await db.$disconnect();hooks.deregister();});
const serialized=rows=>rows.map(m=>({...m,createdAt:m.createdAt.toISOString()}));

test('display cursor reads all same-time rows once, survives deleted anchors, scopes conversation, and sees updated content',async()=>{
  const a=await db.conversation.create({data:{}}),b=await db.conversation.create({data:{}});
  const time=new Date('2026-01-01T00:00:00.000Z');
  await db.message.createMany({data:Array.from({length:181},(_,i)=>({id:'p'+String(i).padStart(30,'0'),conversationId:a.id,role:'user',content:'row '+i,createdAt:time}))});
  await db.message.create({data:{conversationId:b.id,role:'user',content:'Other conversation',createdAt:time}});
  let page=await displayPage(a.id);assert.equal(page.messages.length,60);assert.equal(page.older,121);
  const seen=new Set(page.messages.map(m=>m.id));
  const anchor=page.messages[0],raw=displayCursor(a.id,serialized([anchor])[0]);
  assert.throws(()=>parseDisplayCursor(raw,b.id),/Invalid/);
  await db.message.delete({where:{id:anchor.id}});
  await db.message.update({where:{id:'p'+String(100).padStart(30,'0')},data:{content:'Updated display content'}});
  await db.message.create({data:{conversationId:a.id,role:'secretary',content:'New reply',createdAt:new Date('2026-02-01')}});
  while(page.older){page=await displayPage(a.id,parseDisplayCursor(displayCursor(a.id,serialized(page.messages)[0]),a.id));
    for(const m of page.messages){assert.ok(!seen.has(m.id));assert.ok(m.content!=='Other conversation'&&m.content!=='New reply');if(m.id==='p'+String(100).padStart(30,'0'))assert.equal(m.content,'Updated display content');seen.add(m.id);}}
  assert.equal(seen.size,181);
  assert.deepEqual((await displayPage(a.id,{id:'p000',createdAt:new Date('2000-01-01')})),{messages:[],older:0});
  for(const raw of ['null','{}','x','x'.repeat(1100),JSON.stringify({v:1,conversationId:a.id,id:'bad/id',createdAt:time.toISOString()}),JSON.stringify({v:1,conversationId:a.id,id:'valid',createdAt:'2026-02-31'})])assert.throws(()=>parseDisplayCursor(raw,a.id));
  const req=raw=>new Request('http://localhost/api/chat/history?'+new URLSearchParams({conversationId:a.id,page:'older',before:raw}));
  assert.equal((await GET(req(displayCursor(b.id,serialized([anchor])[0])))).status,400);
  state.authorized=false;assert.equal((await GET(req(raw))).status,401);state.authorized=true;
  const response=await GET(req(raw));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).messages.length,60);
});

test('client merge preserves object identity, applies edits/attachments, deduplicates and orders ties',()=>{
  const a={id:'a',createdAt:'2026-01-01',role:'user',content:'a',attachments:[]},b={...a,id:'b',content:'b'};
  const old=[a,b];assert.equal(mergeDisplayMessages(old,[{...a},{...b}]),old);
  const next=mergeDisplayMessages(old,[{...a,attachments:[{id:'file',filename:'new',size:1}]},{...b}]);assert.equal(next[1],b);assert.equal(next[0].attachments.length,1);
  assert.deepEqual(mergeDisplayMessages([b],[a,b]).map(m=>m.id),['a','b']);
});

test('concurrent title requests share one job, have no tools/retries, and preserve the newest activity time',async()=>{
  const c=await db.conversation.create({data:{}});let release;state.calls=[];
  state.generate=()=>new Promise(r=>{release=r;});
  const jobs=Array.from({length:6},()=>autoTitle(c.id,'hello','reply'));
  while(!release)await new Promise(r=>setTimeout(r,5));
  const activity=new Date('2026-05-01');await db.conversation.update({where:{id:c.id},data:{updatedAt:activity}});
  release({text:'Generated title'});assert.deepEqual(await Promise.all(jobs),Array(6).fill('Generated title'));
  assert.equal(state.calls.length,1);assert.equal(state.calls[0].tools,undefined);assert.equal(state.calls[0].maxRetries,0);assert.ok(state.calls[0].abortSignal);
  assert.equal((await db.conversation.findUnique({where:{id:c.id}})).updatedAt.toISOString(),activity.toISOString());
  assert.equal(await autoTitle(c.id,'second',''), 'Generated title');assert.equal(state.calls.length,1);
});

test('manual rename and deletion during title generation cannot be overwritten or resurrected',async()=>{
  for(const remove of [false,true]){
    const c=await db.conversation.create({data:{}});let release;state.generate=()=>new Promise(r=>{release=r;});
    const job=autoTitle(c.id,'hello','reply');while(!release)await new Promise(r=>setTimeout(r,5));
    if(remove)await db.conversation.delete({where:{id:c.id}});else await db.conversation.update({where:{id:c.id},data:{title:'Manual'}});
    release({text:'Generated title'});assert.equal(await job,remove?null:'Manual');
  }
});

test('a stalled title aborts within its deadline and saves a fallback; Codex never starts the API request',async()=>{
  const c=await db.conversation.create({data:{}});let signal;state.generate=options=>{signal=options.abortSignal;return new Promise(()=>{});};
  const started=Date.now();assert.equal(await autoTitle(c.id,'Fallback title','reply'),'Fallback title');assert.ok(signal.aborted);assert.ok(Date.now()-started<10000);
  const codex=await db.conversation.create({data:{backend:'codex'}}),count=state.calls.length;
  assert.equal(await autoTitle(codex.id,'Codex first message','reply'),'Codex first message');assert.equal(state.calls.length,count);
});
