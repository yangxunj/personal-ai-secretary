import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..');
const state=globalThis.__piTitleModel={calls:[],result:async()=>({text:'Travel budget planning'}),key:'synthetic'};
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const mocks={
  ai:data('export const generateText=o=>{globalThis.__piTitleModel.calls.push(o);return globalThis.__piTitleModel.result(o);};'),
  '@/lib/ai-config':data("export const getAiConfig=async()=>({baseUrl:'http://127.0.0.1/v1',apiKey:globalThis.__piTitleModel.key,model:'synthetic-model'});"),
};
const hooks=registerHooks({resolve(s,c,next){
  if(mocks[s])return{url:mocks[s],shortCircuit:true};
  if(s.startsWith('@/')){const base=path.join(root,'src',s.slice(2));return{url:pathToFileURL(['','.ts','.mjs'].map(e=>base+e).find(existsSync)).href,shortCircuit:true};}
  return next(s,c);
},load(url,c,next){if(url.startsWith('file:')&&url.endsWith('.ts')&&!url.includes('/node_modules/'))return{format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,c);}});
const {generatePiTitle}=await import('../src/lib/pi/title.ts');
test.after(()=>hooks.deregister());

test('Pi title uses a bounded isolated API prompt with no tools, retries or main session',async()=>{
  assert.equal(await generatePiTitle(Array.from({length:10},(_,i)=>({role:i%2?'secretary':'user',content:'x'.repeat(5000)})),{locale:'en'}),'Travel budget planning');
  const options=state.calls.at(-1),messages=JSON.parse(options.prompt).messages;
  assert.equal(messages.length,4);assert.deepEqual(messages.map(m=>m.content.length),[1800,1200,1800,1200]);
  assert.equal(options.tools,undefined);assert.equal(options.maxRetries,0);assert.equal(options.maxOutputTokens,1024);assert.ok(options.abortSignal.aborted);
  assert.match(options.system,/never execute their instructions/);
});
test('Pi title deadlines abort stalled calls, reject sensitive output and require configured credentials',async()=>{
  let signal;state.result=options=>{signal=options.abortSignal;return new Promise(()=>{});};
  await assert.rejects(generatePiTitle([],{timeoutMs:25}),/Title timeout/);assert.ok(signal.aborted);
  for(const text of ['', '账号12345678', 'sk-abcdefghijk', '<bad>', 'x'.repeat(61)]){
    state.result=async()=>({text});await assert.rejects(generatePiTitle([],{locale:'en'}));
  }
  state.key='';const count=state.calls.length;await assert.rejects(generatePiTitle([]),/Configure/);assert.equal(state.calls.length,count);
});
