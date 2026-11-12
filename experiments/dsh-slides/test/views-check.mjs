// Optional compatibility check against a separately obtained official DSH Go SDK.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { listView, deckView } from '../lib/views.js';
const sdk = process.argv[2];
if (!sdk) throw new Error('Pass the path to sdk/plugin-kit/bin/check.mjs');
const dir = mkdtempSync(join(tmpdir(), 'dsh-slide-views-'));
try {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const deck = { id, title: '光合作用', markdown: '# 首页\n\n---\n\n# 第二页', createdAt: 1 };
  for (const [name, view] of [['empty', listView([])], ['list', listView([deck])], ['page', deckView(deck, 0)], ['next', deckView(deck, 1)]]) {
    const path = join(dir, name + '.json'); writeFileSync(path, JSON.stringify(view));
    const result = spawnSync(process.execPath, [resolve(sdk), path, '--budget', 'panel', '--json'], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${name} view failed SDK check: ${result.stdout} ${result.stderr}`);
    console.log(`${name} view: SDK check passed`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
