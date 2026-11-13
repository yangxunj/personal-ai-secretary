import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { apply } from '../lib/index.js';
import { createStore } from '../lib/store.js';
import { splitPages } from '../lib/views.js';
import ts from 'typescript';

test('DSH tools create durable isolated slides and the native panel opens and pages them', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-slides-test-'));
  try {
    const tools = [], panels = new Map(), routes = new Map();
    const ctx = { tools: { register: tool => tools.push(tool) }, inject: (deps, fn) => deps[0] === 'connection'
      ? fn({ connection: { fetch: { register: route => routes.set(route.path, route) } } })
      : fn({ dshGo: { panel: (id, panel) => panels.set(id, panel) } }) };
    apply(ctx, { directory });
    const create = tools.find(tool => tool.name === 'secretary_create_slides');
    const list = tools.find(tool => tool.name === 'secretary_list_slides');
    const read = tools.find(tool => tool.name === 'secretary_read_slides');
    const response = await create.execute({ title: '光合作用', markdown: '# 首页\n\n---\n\n# 第二页' });
    assert.deepEqual(validateJsonSchemaValue(create.output.schema, response, 'value'), []);
    const created = JSON.parse(response); assert.equal(created.ok, true); assert.equal(created.pages, 2);
    assert.equal(JSON.parse(await list.execute({})).decks[0].id, created.id);
    const call = async (action, payload) => (await (await routes.get('/api/secretary-slides/' + action).fetch(new Request('https://local/api', { method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'secretary-slides/' + action, payload }) }))).json()).result;
    assert.equal((await call('list', {})).value[0].id, created.id);
    assert.equal((await call('read', { id: created.id })).value.title, '光合作用');
    assert.match(JSON.parse(await read.execute({ id: created.id })).deck.markdown, /第二页/);
    assert.equal(createStore(directory).list().length, 1);
    const panel = panels.get('slides'), scope = { sessionId: 'test' };
    assert.equal(panel.view(scope).children[1].items[0].title, '光合作用');
    assert.deepEqual(panel.actions.open(scope, { value: { id: created.id } }), { refresh: true });
    assert.match(panel.view(scope).children[1].text, /首页/);
    panel.actions.next(scope); assert.match(panel.view(scope).children[1].text, /第二页/);
    panel.actions.list(scope); assert.equal(panel.view(scope).children[1].items[0].title, '光合作用');
    assert.equal(readFileSync(join(directory, created.id + '.json'), 'utf8').includes('第二页'), true);
    assert.equal(createStore(directory).read('../other'), null);
    assert.throws(() => createStore(directory).create({ title: '', markdown: 'test' }));
    assert.throws(() => createStore(directory).create({ title: '空', markdown: '---' }));
    assert.equal(createStore(directory).list().length, 1);
    assert.equal(splitPages('a'.repeat(3601)).length, 3);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the shipped validation is generated from the shared slide contract', () => {
  const source = readFileSync(new URL('../../../src/lib/slides/contracts.ts', import.meta.url), 'utf8');
  const expected = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const shipped = readFileSync(new URL('../lib/contracts.js', import.meta.url), 'utf8');
  assert.equal(shipped.replace(/\r\n/g, '\n'), '// Generated from src/lib/slides/contracts.ts; run build-shared.mjs after changing it.\n' + expected.replace(/\r\n/g, '\n'));
});
