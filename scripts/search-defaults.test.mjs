import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const directory = await mkdtemp(path.join(tmpdir(), 'secretary-search-defaults-'));
const state = globalThis.__searchDefaults = {
  settings: new Map(),
  ai: { baseUrl: 'https://api.deepseek.com', apiKey: 'synthetic-chat-key', model: 'synthetic-model' },
  connections: [],
};
const savedKeys = Object.fromEntries(['DEEPSEEK_SEARCH_API_KEY', 'DEEPSEEK_API_KEY'].map(key => [key, process.env[key]]));
for (const key of Object.keys(savedKeys)) delete process.env[key];
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const mocks = {
  '@/lib/db': data(`export const db={setting:{findMany:async({where})=>[...globalThis.__searchDefaults.settings].filter(([key])=>where.key.in.includes(key)).map(([key,value])=>({key,value}))}};`),
  '@/lib/ai-config': data('export const getAiConfig=async()=>globalThis.__searchDefaults.ai;'),
  '@/lib/storage': data(`export const UPLOAD_DIR=${JSON.stringify(path.join(directory, 'uploads'))};`),
};
const protocol = data(`export class CodexConnection {
  constructor(options){this.options=options;globalThis.__searchDefaults.connections.push(this);}
  async connect(){}
  async request(method){return method==='account/read'?{account:{type:'synthetic'}}:{config:{mcp_servers:{syntheticPrivate:{}}}};}
  close(){}
}`);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (mocks[specifier]) return { url: mocks[specifier], shortCircuit: true };
    if (specifier === './protocol.mjs' && context.parentURL?.endsWith('/codex/config.ts')) return { url: protocol, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return { format: 'module', source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, shortCircuit: true };
    return next(url, context);
  },
});
const { getWebSearchConfig } = await import('../src/lib/web-search/config.ts');
const { getCodexConfig, openCodex } = await import('../src/lib/codex/config.ts');
const savedDesktop = process.env.DESKTOP_APP;
test.after(async () => {
  hooks.deregister();
  if (savedDesktop === undefined) delete process.env.DESKTOP_APP; else process.env.DESKTOP_APP = savedDesktop;
  for (const [key, value] of Object.entries(savedKeys)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  delete globalThis.__searchDefaults;
  await rm(directory, { recursive: true, force: true });
});

test('new and legacy disabled settings both expose search with the official chat key', async () => {
  for (const legacy of [undefined, 'false', 'true']) {
    state.settings.clear();
    if (legacy !== undefined) { state.settings.set('webSearch.enabled', legacy); state.settings.set('codex.webSearch', legacy); }
    assert.deepEqual(await getWebSearchConfig(), { enabled: true, apiKey: 'synthetic-chat-key' });
    assert.equal((await getCodexConfig()).webSearchEnabled, true);
  }
});

test('a dedicated search key remains available for custom model endpoints', async () => {
  state.ai = { ...state.ai, baseUrl: 'https://model.example.com/v1' };
  state.settings.set('webSearch.apiKey', 'synthetic-dedicated-key');
  assert.deepEqual(await getWebSearchConfig(), { enabled: true, apiKey: 'synthetic-dedicated-key' });
});

test('Codex enables search for chat while non-chat calls keep it disabled and inherited MCP blocked', async () => {
  process.env.DESKTOP_APP = '1';
  for (const forChat of [true, false]) {
    const result = await openCodex({ forChat });
    assert.equal(result.webSearch, forChat ? 'live' : 'disabled');
    assert.equal(result.client.options.webSearch, result.webSearch);
    assert.equal(result.config.web_search, result.webSearch);
    assert.equal(result.config['mcp_servers.syntheticPrivate.enabled'], false);
    result.client.close();
  }
});
