import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('refuses an unrecognized DSH sidebar before building', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'dsh-sidebar-guard-'));
  try {
    const fakeClient = Buffer.from('unrecognized client');
    const fakePackage = Buffer.from('{"version":"0.2.2-rc.2"}');
    const sidebar = { files: { lib: { files: { 'client.js': { offset: '0', size: fakeClient.length } } }, 'package.json': { offset: String(fakeClient.length), size: fakePackage.length } } };
    let tree = sidebar;
    for (const part of ['dsh-client-ui-sidebar', '@deepseek-ai', 'node_modules', 'dsh']) tree = { files: { [part]: tree } };
    const json = Buffer.from(JSON.stringify(tree));
    const head = Buffer.alloc(16);
    head.writeUInt32LE(json.length + 8, 4);
    head.writeUInt32LE(json.length, 12);
    const archive = path.join(temp, 'app.asar');
    await writeFile(archive, Buffer.concat([head, json, fakeClient, fakePackage]));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./build-isolated.mjs', import.meta.url)), archive, '--verify-only'], { encoding:'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /版本不匹配/);
  } finally {
    await rm(temp, { recursive:true, force:true });
  }
});
