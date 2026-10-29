import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const state = globalThis.__harnessSettings = { settings: new Map(), authorized: true, enabled: true, failCodex: false, failApi: false, calls: [], checks: [] };
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const mocks = {
  'next/navigation': data('export function redirect(url){throw new Error("REDIRECT:"+url);}'),
  'next/headers': data('export const headers=async()=>new Headers();'),
  'next/cache': data('export const revalidatePath=()=>{};'),
  '@/lib/auth': data('export const sessionIsCurrent=async()=>globalThis.__harnessSettings.authorized;export const changePassword=async()=>{},createSession=async()=>{},destroySession=async()=>{};'),
  '@/lib/login-throttle': data('export const checkThrottle=()=>{},recordFailure=()=>{},recordSuccess=()=>{},sleep=()=>{},clientKey=()=>{};'),
  '@/lib/owners': data('export const parseOwners=()=>{},setOwners=()=>{};'),
  '@/lib/i18n/server': data('export const getT=async()=>(text)=>text;export const setLocale=async()=>{};'),
  '@/lib/db': data(`export const db={setting:{findMany:async({where})=>[...globalThis.__harnessSettings.settings].filter(([key])=>where.key.in.includes(key)).map(([key,value])=>({key,value})),upsert:({where,create,update})=>({where,create,update})},$transaction:async(ops)=>{const map=globalThis.__harnessSettings.settings;for(const op of ops)map.set(op.where.key,map.has(op.where.key)?op.update.value:op.create.value);}};`),
  '@/lib/codex/config': data(`export const localCodexEnabled=()=>globalThis.__harnessSettings.enabled;export const getCodexConfig=async()=>({executable:globalThis.__harnessSettings.settings.get('codex.path')||'',model:globalThis.__harnessSettings.settings.get('codex.model')||'',effort:'medium',webSearchEnabled:true});export const diagnoseCodex=async(cfg)=>{globalThis.__harnessSettings.checks.push(cfg);if(globalThis.__harnessSettings.failCodex)throw Error('Synthetic unavailable executable');return{model:cfg.model||'synthetic-codex',models:[{id:cfg.model||'synthetic-codex',efforts:['low','medium','high','xhigh']}]};};export const openCodex=async()=>{};`),
};
const hooks=registerHooks({resolve(s,c,next){if(mocks[s])return{url:mocks[s],shortCircuit:true};if(s.startsWith('@/')){const base=path.join(root,'src',s.slice(2));return{url:pathToFileURL(['','.ts','.mjs'].map(e=>base+e).find(existsSync)).href,shortCircuit:true};}return next(s,c);},load(url,c,next){if(url.startsWith('file:')&&url.endsWith('.ts'))return{format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,c);}});
const {saveHarnessSettingsAction}=await import('../src/app/(app)/settings/actions.ts');
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{state.calls.push({url,init});return state.failApi?new Response('Synthetic rejected key',{status:401}):Response.json({choices:[{message:{content:'OK'}}]});};
test.after(()=>{hooks.deregister();globalThis.fetch=originalFetch;delete globalThis.__harnessSettings;});
const form=entries=>{const data=new FormData();for(const [key,value] of Object.entries(entries))data.set(key,value);return data;};
const save=data=>saveHarnessSettingsAction({ok:false,message:''},form(data));
const snapshot=()=>JSON.stringify([...state.settings]);
test.beforeEach(()=>{state.settings=new Map([['ai.backend','codex'],['ai.baseUrl','https://api.deepseek.com'],['ai.model','synthetic-old-model'],['ai.apiKey','synthetic-stored-key'],['codex.path','C:/synthetic/original.exe'],['codex.model','synthetic-original-codex'],['codex.effort','medium']]);state.authorized=state.enabled=true;state.failApi=state.failCodex=false;state.calls=[];state.checks=[];});

test('Pi save validates draft then updates its settings and default while retaining Codex configuration',async()=>{
  const result=await save({backend:'pi',baseUrl:'https://api.deepseek.com',model:'synthetic-new-model',apiKey:'synthetic-new-key',codexPath:'ignored.exe'});
  assert.equal(result.ok,true);assert.equal(state.settings.get('ai.backend'),'pi');assert.equal(state.settings.get('ai.model'),'synthetic-new-model');assert.equal(state.settings.get('ai.apiKey'),'synthetic-new-key');assert.equal(state.settings.get('codex.path'),'C:/synthetic/original.exe');assert.equal(state.checks.length,0);assert.equal(state.calls.length,1);assert.doesNotMatch(JSON.stringify(result),/synthetic-new-key/);
});
test('Pi blank key retains the saved key and failed checks never switch or overwrite saved configuration',async()=>{
  await save({backend:'pi',baseUrl:'https://api.deepseek.com',model:'synthetic-new-model',apiKey:''});assert.equal(state.settings.get('ai.apiKey'),'synthetic-stored-key');
  state.failApi=true;const before=snapshot();const result=await save({backend:'pi',baseUrl:'https://api.deepseek.com',model:'bad-model',apiKey:'synthetic-bad-key'});assert.equal(result.ok,false);assert.equal(snapshot(),before);
});
test('Codex saves the checked draft and default together without changing Pi settings or using its key',async()=>{
  state.settings.set('ai.backend','pi');const result=await save({backend:'codex',codexPath:'C:/synthetic/new.exe',codexModel:'synthetic-new-codex',codexEffort:'high',apiKey:'must-not-be-saved'});
  assert.equal(result.ok,true);assert.equal(state.settings.get('ai.backend'),'codex');assert.equal(state.settings.get('codex.path'),'C:/synthetic/new.exe');assert.equal(state.settings.get('codex.effort'),'high');assert.equal(state.settings.get('ai.apiKey'),'synthetic-stored-key');assert.equal(state.calls.length,0);assert.equal(state.checks[0].executable,'C:/synthetic/new.exe');
});
test('Codex validation failure, invalid effort and disabled deployment leave the active backend and both configurations intact',async()=>{
  state.settings.set('ai.backend','pi');state.failCodex=true;const before=snapshot();assert.equal((await save({backend:'codex',codexPath:'missing.exe'})).ok,false);assert.equal(snapshot(),before);
  state.failCodex=false;assert.equal((await save({backend:'codex',codexEffort:'invalid'})).ok,false);assert.equal(snapshot(),before);
  state.enabled=false;assert.equal((await save({backend:'codex'})).ok,false);assert.equal(snapshot(),before);
});
test('invalid and unauthenticated requests cannot write or call a provider',async()=>{
  const before=snapshot();assert.equal((await save({backend:'api'})).ok,false);assert.equal(snapshot(),before);
  state.authorized=false;await assert.rejects(save({backend:'pi'}),/REDIRECT:\/login/);assert.equal(snapshot(),before);assert.equal(state.calls.length,0);assert.equal(state.checks.length,0);
});
