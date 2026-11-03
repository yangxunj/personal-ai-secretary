import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourceUrl = new URL('../../src/lib/collections/schema.ts', import.meta.url);
const original = readFileSync(sourceUrl, 'utf8');
const compiled = ts.transpileModule(original, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const serverContext = vm.createContext({ exports: {}, require });
vm.runInContext(compiled, serverContext);
const server = serverContext.exports;
const browser = vm.createContext({ console });
vm.runInContext(readFileSync(new URL('web-dist/pilot.js', import.meta.url), 'utf8'), browser);
const core = browser.PilotCore;
const plain = value => JSON.parse(JSON.stringify(value));

test('Android bundle contains the exact current shared source and its rules pass', () => {
  const manifest = JSON.parse(readFileSync(new URL('web-dist/build-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.sharedSourceSha256, createHash('sha256').update(readFileSync(sourceUrl)).digest('hex'));
  assert.equal(manifest.bundleSha256, createHash('sha256').update(readFileSync(new URL('web-dist/pilot.js', import.meta.url))).digest('hex'));
  assert.equal(core.runRuleChecks().length, 6);
  assert.ok(core.runRuleChecks().every(row => row.passed));
});

test('Node and browser execute the same schema with matching normalization and errors', () => {
  const definition = server.parseDefinition(plain(core.definition));
  const cases = [
    { name: ' 小王子 ', status: '在读', date: '' },
    { name: '三体', status: '读完', date: '2024-02-29' },
    { name: '', status: '想读' },
    { name: '测试', status: '想读', date: '2025-02-29' },
    { name: '测试', status: '未知' },
    { name: '书'.repeat(201), status: '想读' },
    { name: '测试', status: '想读', undeclared: 1 },
  ];
  const outcome = (validate, def, input) => {
    try { return { values: plain(validate(def, input)) }; }
    catch (error) { return { code: error.code, field: error.field }; }
  };
  for (const input of cases) assert.deepEqual(outcome(server.validateValues, definition, input), outcome(core.validateValues, core.definition, input));
});

test('invalid records never reach platform storage and failed writes do not create success', () => {
  let writes = 0;
  const records = core.createRecords({ list: () => [], append: () => { writes++; throw new Error('disk full'); } });
  assert.throws(() => records.append({ name: '', status: '想读' }));
  assert.equal(writes, 0);
  assert.throws(() => records.append({ name: '测试', status: '想读' }), /disk full/);
  assert.equal(writes, 1);
});

test('storage adapter receives normalized values rather than raw form input', () => {
  let saved;
  const records = core.createRecords({ list: () => [], append: values => { saved = plain(values); return { id: 'synthetic', values }; } });
  const result = records.append({ name: ' 测试 ', status: '想读', date: '' });
  assert.equal(result.id, 'synthetic');
  assert.deepEqual(saved, { name: '测试', status: '想读' });
});

test('the local pilot package cannot silently enable networking or remote frames', () => {
  const manifest = readFileSync(new URL('android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  const html = readFileSync(new URL('web/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(manifest, /<uses-permission[^>]+android\.permission\.INTERNET/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /frame-src 'none'/);
});
