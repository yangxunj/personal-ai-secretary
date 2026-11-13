// Run against the installed package, not the working-tree dependency set.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const target = process.argv[2];
if (!target) throw new Error('Pass installed plugin directory');
const { apply } = await import(pathToFileURL(resolve(target, 'lib/index.js')).href);
const directory = mkdtempSync(join(tmpdir(), 'dsh-installed-test-'));
try {
  const tools = [], routes = new Map();
  const ctx = { tools: { register: tool => tools.push(tool) }, inject: (deps, fn) => {
    if (deps[0] === 'connection') fn({ connection: { fetch: { register: route => routes.set(route.path, route) } } });
  } };
  apply(ctx, { directory });
  const create = tools.find(tool => tool.name === 'secretary_create_slides');
  const saved = JSON.parse(await create.execute({ title: '隔离测试', markdown: '# 首页\n\n---\n\n# 第二页' }));
  assert.equal(saved.ok, true);
  const route = routes.get('/api/secretary-slides/list');
  const request = new Request('https://example.test/api/secretary-slides/list', { method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'secretary-slides/list', payload: {} }) });
  const result = await (await route.fetch(request)).json();
  assert.equal(result.result.value[0].id, saved.id);
  console.log('Installed DSH tool creates data that the desktop route reads.');
} finally { rmSync(directory, { recursive: true, force: true }); }
