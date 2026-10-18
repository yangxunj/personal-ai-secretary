import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { GwsMailReader, mailEnvironment, normalizeMail } from '../src/lib/mail/gws.mjs';
import { scanBatch } from '../src/lib/mail/scan-core.mjs';
import { validateDecisions } from '../src/lib/mail/decisions.mjs';
import { MailStore, initialMailState } from '../src/lib/mail/store.mjs';
const require = createRequire(import.meta.url);
const { validClient, authorizationUrl, trustedSender, setupGmail } = require('../desktop/gmail.js');
const data = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
function loadTs(file, replacements) {
  let source = readFileSync(new URL(file, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(`'${from}'`, JSON.stringify(to));
  return import(data(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText));
}
const sample = id => ({ id, threadId: id, internalDate: '1792100000000', payload: { headers: [{ name: 'Subject', value: 'Fictional school notice' }], mimeType: 'text/plain', body: { data: Buffer.from('Reply by 2026-10-25.').toString('base64url') } } });
const decision = id => ({ id, importance: 'review', summary: 'Check school notice', action: 'Verify and reply', dueDate: '2026-10-25', evidence: 'Reply by 2026-10-25.' });
async function temp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'secretary-gmail-test-'));
  t.after(async () => {
    const rel = path.relative(os.tmpdir(), dir); assert(!rel.startsWith('..') && !path.isAbsolute(rel));
    await rm(dir, { recursive: true, force: true });
  }); return dir;
}
test('GWS reading rejects write methods and isolates credentials, cwd and diagnostics', async () => {
  const env = mailEnvironment('/fictional/account', { GOOGLE_WORKSPACE_CLI_TOKEN: 'fake', GOOGLE_WORKSPACE_CLI_LOG: 'trace', GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND: 'file', HTTPS_PROXY: 'http://proxy.invalid' });
  assert.equal(env.GOOGLE_WORKSPACE_CLI_TOKEN, undefined); assert.equal(env.GOOGLE_WORKSPACE_CLI_LOG, undefined); assert.equal(env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND, undefined);
  assert.equal(env.HTTPS_PROXY, 'http://proxy.invalid');
  let calls = 0;
  const reader = new GwsMailReader({ executable: 'fake', configDir: '/fictional/account', execute: async (_, args, options) => {
    calls++; assert.equal(options.cwd, '/fictional/account'); assert.equal(JSON.parse(args.at(-1)).userId, 'me');
    return { stdout: JSON.stringify({ emailAddress: 'demo@example.com' }) };
  } });
  await assert.rejects(reader.call('messages.send')); await assert.rejects(reader.call('messages.modify')); assert.equal(calls, 0);
  await reader.profile('demo@example.com'); await assert.rejects(reader.profile('other@example.com'));
});
test('OAuth accepts only Desktop clients and validated Google readonly authorization URLs', () => {
  const client = { installed: { client_id: 'fictional.apps.googleusercontent.com', client_secret: 'fictional', auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token' } };
  assert(validClient(client).installed); assert.throws(() => validClient({ web: client.installed }));
  assert.throws(() => validClient({ installed: { ...client.installed, token_uri: 'https://evil.invalid/token' } }));
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&scope=' + encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly');
  assert.equal(authorizationUrl(url), url); assert.equal(authorizationUrl(url.replace('gmail.readonly', 'gmail.modify')), null);
  assert.equal(authorizationUrl(url.replace('accounts.google.com', 'evil.invalid')), null);
});
test('only the native main window and its local origin can access Gmail IPC', () => {
  const frame = { url: 'http://127.0.0.1:3000/mail' }, win = { webContents: { mainFrame: frame } };
  const event = { sender: win.webContents, senderFrame: frame };
  assert(trustedSender(event, win, 'http://127.0.0.1:3000'));
  assert(!trustedSender({ ...event, senderFrame: { url: frame.url } }, win, 'http://127.0.0.1:3000'));
  frame.url = 'https://example.invalid'; assert(!trustedSender(event, win, 'http://127.0.0.1:3000'));
});
test('native import validates a chosen client, keeps secrets off IPC, and disconnect clears only its account folder', async t => {
  const root = await temp(t), file = path.join(root, 'client.json');
  await writeFile(file, JSON.stringify({ installed: { client_id: 'fictional.apps.googleusercontent.com', client_secret: 'private-fixture', auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token' } }));
  const frame = { url: 'http://127.0.0.1:3000/mail' }, win = { webContents: { mainFrame: frame } }; let handler;
  const fakeStatus = { connected: false, findings: [], analysisTarget: { key: 'one' } };
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers['x-desktop-gmail'], 'fictional-token');
    const { action } = JSON.parse(options.body); return Response.json(action === 'stop' ? { stopped: true } : fakeStatus);
  });
  const bridge = setupGmail({ ipcMain: { handle: (_, fn) => { handler = fn; }, removeHandler() {} }, dialog: { showOpenDialog: async () => ({ filePaths: [file] }) },
    shell: {}, Notification: { isSupported: () => false }, getWindow: () => win, getBaseUrl: () => 'http://127.0.0.1:3000', token: 'fictional-token', root, executable: path.join(root, 'missing.exe'), getLocale: () => 'en' });
  t.after(() => bridge.dispose());
  const event = { sender: win.webContents, senderFrame: frame };
  assert.equal((await handler({ sender: {} }, 'import')).error, 'MAIL_DESKTOP_ONLY');
  const status = await handler(event, 'import'); assert(status.clientReady); assert(!JSON.stringify(status).includes('private-fixture'));
  assert.equal(JSON.parse(await readFile(path.join(root, 'account/client_secret.json'), 'utf8')).installed.client_secret, 'private-fixture');
  assert.equal((await handler(event, 'arbitrary-command')).error, 'MAIL_INVALID_ACTION');
  await handler(event, 'disconnect'); await assert.rejects(access(path.join(root, 'account'))); await access(file);
  await bridge.shutdown();
});
test('message parsing never includes attachment content and marks body truncation', () => {
  const mail = sample('one'); mail.payload.parts = [{ mimeType: 'text/plain', filename: 'example.txt', body: { data: Buffer.from('secret attachment').toString('base64url') } }];
  assert(!normalizeMail(mail, 'demo@example.com').body.includes('secret attachment'));
  mail.payload.body.data = Buffer.from('a'.repeat(12001)).toString('base64url'); assert(normalizeMail(mail, 'demo@example.com').bodyTruncated);
});
test('analysis rejects invented evidence, missing items and impossible dates', () => {
  const messages = [normalizeMail(sample('one'), 'demo@example.com')];
  assert.deepEqual(validateDecisions({ decisions: [decision('one')] }, messages), [decision('one')]);
  assert.throws(() => validateDecisions({ decisions: [] }, messages));
  assert.throws(() => validateDecisions({ decisions: [{ ...decision('one'), evidence: 'invented fact' }] }, messages));
  assert.throws(() => validateDecisions({ decisions: [{ ...decision('one'), dueDate: '2026-02-30' }] }, messages));
});
test('pagination preserves the fixed window and advances only after all mail is analyzed', async () => {
  const start = initialMailState('demo@example.com'), until = new Date(); let listing = 0;
  const reader = { profile: async () => {}, list: async () => { listing++; return { messages: [{ id: 'one' }, { id: 'two' }] }; }, message: async id => sample(id) };
  const first = await scanBatch({ state: start, reader, account: start.account, now: until, limit: 1, analyze: async items => items.map(m => decision(m.id)) });
  assert.equal(first.cursor, start.cursor); assert(first.morePending);
  const second = await scanBatch({ state: first, reader, account: start.account, limit: 1, analyze: async items => items.map(m => decision(m.id)) });
  assert.equal(second.cursor, Math.floor(until.getTime() / 1000)); assert(!second.morePending); assert.equal(listing, 1);
  assert(!('body' in second.findings[0])); assert(!('snippet' in second.findings[0]));
  await assert.rejects(scanBatch({ state: start, reader, account: start.account, analyze: async () => [] })); assert.equal(start.totalAnalyzed, 0);
});
test('ledger corruption fails closed and concurrent updates do not lose changes', async t => {
  const dir = await temp(t), store = new MailStore(dir);
  assert.equal(await store.read(), null); await store.write(initialMailState('demo@example.com'));
  await Promise.all(Array.from({ length: 5 }, () => store.update(state => ({ ...state, totalAnalyzed: state.totalAnalyzed + 1 }))));
  assert.equal((await store.read()).totalAnalyzed, 5);
  await writeFile(path.join(dir, 'state.json'), '{broken'); await assert.rejects(store.read(), /MAIL_STATE_INVALID/);
  assert.equal(await readFile(path.join(dir, 'state.json'), 'utf8'), '{broken');
  await store.clear(); assert.equal(await store.read(), null);
  await store.write(initialMailState('demo@example.com'));
  const update = store.update(async state => { await new Promise(r => setTimeout(r, 10)); return { ...state, totalAnalyzed: 10 }; });
  await Promise.all([update, store.clear()]); assert.equal(await store.read(), null);
});

const mock = globalThis.__gmailTest = { target: { label: 'Fictional API', key: 'one' }, calls: 0, tasks: new Map(), analysis: null };
const service = await loadTs('../src/lib/mail/service.ts', {
  '@/lib/db': data('export const db={task:{upsert:async({where,create})=>{const m=globalThis.__gmailTest.tasks;if(!m.has(where.id))m.set(where.id,create);return m.get(where.id)}}};'),
  './store.mjs': new URL('../src/lib/mail/store.mjs', import.meta.url).href,
  './gws.mjs': data('export class GwsMailReader{async profile(){globalThis.__gmailTest.calls++}async list(){return{messages:[{id:"one"}]}}async message(id){return{id,threadId:id,payload:{headers:[{name:"Subject",value:"Fictional notice"}],mimeType:"text/plain",body:{data:Buffer.from("Reply by 2026-10-25.").toString("base64url")}}}}}'),
  './scan-core.mjs': new URL('../src/lib/mail/scan-core.mjs', import.meta.url).href,
  './analysis': data('export const mailAnalysisTarget=async()=>globalThis.__gmailTest.target;export const analyzeMessages=(m,s)=>globalThis.__gmailTest.analysis(m,s);'),
});
async function fixture(t) {
  const root = await temp(t), names = ['DESKTOP_APP', 'GMAIL_DATA_DIR', 'GMAIL_GWS_PATH']; const old = Object.fromEntries(names.map(n => [n, process.env[n]]));
  process.env.DESKTOP_APP = '1'; process.env.GMAIL_DATA_DIR = root; process.env.GMAIL_GWS_PATH = 'fictional.exe'; delete globalThis.secretaryMail;
  mock.calls = 0; mock.tasks.clear(); mock.target.key = 'one'; mock.analysis = async items => items.map(m => decision(m.id));
  t.after(async () => { await service.stopMailSync(); delete globalThis.secretaryMail; for (const n of names) old[n] === undefined ? delete process.env[n] : process.env[n] = old[n]; });
  await service.mailCommand('connected', { email: 'demo@example.com' }); return { root, store: new MailStore(root) };
}
const configure = () => service.mailCommand('configure', { analysisApproved: true, enabled: false, intervalMinutes: 10, targetKey: mock.target.key });
async function settled() { while (globalThis.secretaryMail?.running) await globalThis.secretaryMail.running; }
test('sync requires explicit analysis consent and changed models never receive email', async t => {
  const { store } = await fixture(t);
  await assert.rejects(service.mailCommand('sync'), /CONSENT/); assert.equal(mock.calls, 0);
  await configure(); mock.target.key = 'two';
  assert.equal((await service.mailSnapshot()).analysisApproved, false);
  await service.mailCommand('sync'); await settled();
  assert.equal(mock.calls, 0); assert.equal((await store.read()).lastError, 'MAIL_CONSENT_CHANGED');
  assert.equal((await store.read()).analysisApproved, false);
});
test('sync results persist without full bodies and creating a task is explicit and idempotent', async t => {
  const { store } = await fixture(t); await configure(); await service.mailCommand('sync'); await settled();
  assert.equal(mock.tasks.size, 0); assert.equal((await store.read()).findings.length, 1);
  assert(!('body' in (await store.read()).findings[0]));
  const first = await service.mailCommand('task', { id: 'one' }); const second = await service.mailCommand('task', { id: 'one' });
  assert.equal(first.taskId, second.taskId); assert.equal(mock.tasks.size, 1);
});
test('failed AI keeps the cursor and existing reminders and never logs raw provider errors', async t => {
  const { store } = await fixture(t); await configure(); const before = await store.read();
  mock.analysis = async () => { throw new Error('private provider details'); };
  await service.mailCommand('sync'); await settled(); const after = await store.read();
  assert.equal(after.cursor, before.cursor); assert.equal(after.totalAnalyzed, 0); assert.equal(after.lastError, 'MAIL_SCAN_FAILED');
});
test('disconnect aborts in-flight analysis, deletes the ledger and cannot restart the timer', async t => {
  const { root } = await fixture(t); await configure();
  mock.analysis = (_, signal) => signal.aborted ? Promise.reject(signal.reason) : new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  await service.mailCommand('sync'); while (!mock.calls) await new Promise(r => setTimeout(r, 1));
  await service.mailCommand('disconnect'); await new Promise(r => setTimeout(r, 10));
  await assert.rejects(access(path.join(root, 'state.json'))); assert.equal(globalThis.secretaryMail.running, null);
});
test('notification claims happen once and exclude ignored or handled reminders', async t => {
  const { store } = await fixture(t); await store.update(s => ({ ...s, notifications: true, findings: [{ id: 'a' }, { id: 'b', status: 'ignored' }] }));
  assert.equal((await service.mailCommand('notifications')).count, 1); assert.equal((await service.mailCommand('notifications')).count, 0);
});
const route = await loadTs('../src/app/api/desktop/gmail/route.ts', { '@/lib/mail/service': data('export const mailCommand=async()=>({ok:true});') });
test('internal mail API rejects browsers, non-desktop processes and invalid Unicode tokens', async t => {
  const old = { desktop: process.env.DESKTOP_APP, token: process.env.DESKTOP_GMAIL_TOKEN };
  t.after(() => { for (const [key, value] of Object.entries({ DESKTOP_APP: old.desktop, DESKTOP_GMAIL_TOKEN: old.token })) value === undefined ? delete process.env[key] : process.env[key] = value; });
  process.env.DESKTOP_APP = '1'; process.env.DESKTOP_GMAIL_TOKEN = 'fictional-capability';
  const req = token => new Request('http://localhost/api/desktop/gmail', { method: 'POST', headers: token ? { 'x-desktop-gmail': token } : {}, body: '{"action":"status"}' });
  assert.equal((await route.POST(req())).status, 403); assert.equal((await route.POST(req('wrong'))).status, 403);
  assert.equal((await route.POST(req('\u00e9'.repeat('fictional-capability'.length)))).status, 403);
  assert.equal((await route.POST(req('fictional-capability'))).status, 200);
  process.env.DESKTOP_APP = '0'; assert.equal((await route.POST(req('fictional-capability'))).status, 403);
});

const aiMock = globalThis.__gmailAnalysisTest = { backend: 'codex', thread: { id: 'fictional', ephemeral: true, path: null }, sent: 0, closed: 0, model: 'fictional-model' };
const analysis = await loadTs('../src/lib/mail/analysis.ts', {
  'ai': data('export const generateText=async opts=>{if(opts.tools)throw Error("Unexpected tools");globalThis.__gmailAnalysisTest.sent++;return{text:JSON.stringify({decisions:[{id:"one",importance:"ignore",summary:"Routine",action:"",dueDate:null,evidence:""}]})}};'),
  '@ai-sdk/openai-compatible': data('export const createOpenAICompatible=()=>({chatModel:()=>"fictional-model"});'),
  '@/lib/db': data('export const db={setting:{findUnique:async()=>({value:"en"})}};'),
  '@/lib/ai-config': data('export const getAiConfig=async()=>({baseUrl:"https://model.invalid/v1",apiKey:"fictional",model:globalThis.__gmailAnalysisTest.model});'),
  '@/lib/codex/config': data('export const getChatBackend=async()=>globalThis.__gmailAnalysisTest.backend;export const getCodexConfig=async()=>({model:globalThis.__gmailAnalysisTest.model});export const openCodex=async()=>({client:{on(){},request:async()=>({thread:globalThis.__gmailAnalysisTest.thread}),close(){globalThis.__gmailAnalysisTest.closed++}},cfg:{model:globalThis.__gmailAnalysisTest.model},config:{}});'),
  '@/lib/codex/protocol.mjs': data('export const denyRequest=()=>{};export const runTurn=async()=>{globalThis.__gmailAnalysisTest.sent++;return JSON.stringify({decisions:[{id:"one",importance:"ignore",summary:"Routine",action:"",dueDate:null,evidence:""}]})};'),
  './decisions.mjs': new URL('../src/lib/mail/decisions.mjs', import.meta.url).href,
});
test('persistent or uncertain Codex threads receive no email content', async t => {
  const root = await temp(t), old = process.env.GMAIL_DATA_DIR; process.env.GMAIL_DATA_DIR = root;
  t.after(() => { old === undefined ? delete process.env.GMAIL_DATA_DIR : process.env.GMAIL_DATA_DIR = old; });
  aiMock.backend = 'codex'; const target = await analysis.mailAnalysisTarget(); aiMock.sent = 0; aiMock.closed = 0;
  for (const thread of [{ id: 'a', ephemeral: false }, { id: 'b' }, { id: 'c', ephemeral: true, rolloutPath: '/unexpected.log' }]) {
    aiMock.thread = thread;
    await assert.rejects(analysis.analyzeMessages([normalizeMail(sample('one'), 'demo@example.com')], new AbortController().signal, target.key), /MAIL_EPHEMERAL_REQUIRED/);
  }
  assert.equal(aiMock.sent, 0); assert.equal(aiMock.closed, 3);
});
test('both Codex ephemeral analysis and API analysis use the evidence validator', async t => {
  const root = await temp(t), old = process.env.GMAIL_DATA_DIR; process.env.GMAIL_DATA_DIR = root;
  t.after(() => { old === undefined ? delete process.env.GMAIL_DATA_DIR : process.env.GMAIL_DATA_DIR = old; });
  aiMock.thread = { id: 'ephemeral', ephemeral: true, path: null }; aiMock.sent = 0;
  for (const backend of ['codex', 'api']) {
    aiMock.backend = backend; const target = await analysis.mailAnalysisTarget();
    const result = await analysis.analyzeMessages([normalizeMail(sample('one'), 'demo@example.com')], new AbortController().signal, target.key);
    assert.equal(result[0].id, 'one');
  }
  assert.equal(aiMock.sent, 2);
  await assert.rejects(analysis.analyzeMessages([], new AbortController().signal, 'old-consent'), /MAIL_CONSENT_CHANGED/); assert.equal(aiMock.sent, 2);
});
