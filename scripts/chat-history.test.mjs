import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const state = globalThis.__historyTest = { authorized: true, queries: [] };
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
let source = readFileSync(new URL('../src/app/api/chat/history/route.ts', import.meta.url), 'utf8');
source = source.replace("'@/lib/chat-display-history'", JSON.stringify(data(`export const displayOrder=[{createdAt:'desc'},{id:'desc'}];export const displayPage=()=>{throw new Error('Use real SQL pagination tests')};export const parseDisplayCursor=()=>{throw new Error('Use real SQL pagination tests')};`)))
  .replace("'@/lib/auth'", JSON.stringify(data('export const sessionIsCurrent=async()=>globalThis.__historyTest.authorized;')))
  .replace("'@/lib/db'", JSON.stringify(data(`export const db={message:{findMany:async query=>{
    globalThis.__historyTest.queries.push(query);
    return [{id:'new',role:'secretary',content:'DEMO result',createdAt:new Date('2026-01-02'),attachments:[],task:null},
      {id:'old',role:'user',content:'DEMO request',createdAt:new Date('2026-01-01'),attachments:[],task:null}];
  }}};`)));
const { GET } = await import(data(ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText));
const request = (id = 'a'.repeat(32), take = 60) => new Request(`http://localhost/api/chat/history?conversationId=${id}&take=${take}`);

test('history sync requires the current login before reading any messages', async () => {
  state.authorized = false;
  assert.equal((await GET(request())).status, 401);
  assert.equal(state.queries.length, 0);
  state.authorized = true;
});

test('history sync rejects invalid conversation IDs without querying other conversations', async () => {
  for (const id of ['', '../other', 'invalid']) assert.equal((await GET(request(id))).status, 400);
  assert.equal(state.queries.length, 0);
});

test('history sync returns ordered display fields for only the requested conversation without caching', async () => {
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const rows = await response.json();
  assert.deepEqual(rows.map(row => row.id), ['old', 'new']);
  assert.equal(rows[1].createdAt, '2026-01-02T00:00:00.000Z');
  const query = state.queries.at(-1);
  assert.deepEqual(query.where, { conversationId: 'a'.repeat(32) });
  assert.deepEqual(Object.keys(query.select).sort(), ['attachments', 'content', 'createdAt', 'id', 'role', 'task']);
  assert.equal(query.take, 60);
});

test('history sync bounds pagination and retains the legacy conversation scope', async () => {
  for (const [input, expected] of [[-1, 60], ['invalid', 60], [120.9, 120], [999999, 2000], ['Infinity', 2000]]) {
    assert.equal((await GET(request('legacy', input))).status, 200);
    assert.equal(state.queries.at(-1).take, expected);
    assert.deepEqual(state.queries.at(-1).where, { conversationId: 'legacy' });
  }
});
