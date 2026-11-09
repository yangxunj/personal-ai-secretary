import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkSharedCore, sharedEntries, sharedUiEntries } from './check-shared-core.mjs';

test('current shared runtime closure uses only source modules and reviewed Zod', () => {
  const result = checkSharedCore();
  for (const entry of sharedEntries) assert.ok(result.files.includes(entry));
  assert.deepEqual(result.packages, ['zod']);
});

test('production message, conversation and input components stay inside the reviewed shared UI boundary', () => {
  const result = checkSharedCore(undefined, sharedUiEntries, ['react', 'react/jsx-runtime', 'react-markdown', 'remark-gfm', 'unified', 'remark-parse']);
  for (const file of sharedUiEntries) assert.ok(result.files.includes(file));
  assert.ok(result.files.includes('src/components/chat/shared/conversation-list.ts'));
  assert.deepEqual(result.packages, ['react', 'react-markdown', 'react/jsx-runtime', 'remark-gfm', 'remark-parse', 'unified']);
});

test('dependency guard follows aliases and transitive exports, erases types and rejects platform imports', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'secretary-shared-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src', 'lib'), { recursive: true });
  const write = (name, source) => writeFileSync(path.join(root, 'src', name), source);
  write('entry.ts', "import type { T } from 'next'; export { value } from '@/lib/policy';");
  write('lib/policy.ts', 'export const value = 1;');
  assert.equal(checkSharedCore(root, ['src/entry.ts']).files.length, 2);
  for (const specifier of ['node:fs', 'fs', 'next/cache', 'electron', '@prisma/client', 'sharp', 'zod/v4']) {
    write('lib/policy.ts', `export * from '${specifier}';`);
    assert.throws(() => checkSharedCore(root, ['src/entry.ts']), /Platform or unreviewed dependency/);
  }
  for (const expression of ["import('node:fs')", "require('fs')", 'import(target)', 'require(target)']) {
    write('lib/policy.ts', `export const value = ${expression};`);
    assert.throws(() => checkSharedCore(root, ['src/entry.ts']), /dependency|Computed import/);
  }
});
