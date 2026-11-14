import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { stagePptEngineBackup } from './ppt-engine-backup.mjs';

test('PPT backup requires a stopped engine and saves a consistent database and images', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'secretary-ppt-backup-test-'));
  const root = path.join(temp, 'engine');
  const stage = path.join(temp, 'stage');
  const dbPath = path.join(root, 'instance', 'database.db');
  const url = `file:${dbPath.replace(/\\/g, '/')}`;
  let server;
  try {
    await mkdir(path.join(root, 'instance'), { recursive: true });
    await mkdir(path.join(root, 'uploads', 'project', 'pages'), { recursive: true });
    await writeFile(path.join(root, 'instance', '.secretary-control-token'), 'test-only-token');
    await writeFile(path.join(root, 'uploads', 'project', 'pages', 'test.png'), 'synthetic-image');
    const db = new PrismaClient({ datasources: { db: { url } } });
    await db.$executeRawUnsafe('CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL)');
    await db.$executeRawUnsafe("INSERT INTO tasks (id, status) VALUES ('test', 'COMPLETED')");
    await db.$disconnect();
    server = net.createServer();
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await assert.rejects(stagePptEngineBackup({ dataRoot: root, stage, port }), /请先停止 PPT 引擎/);
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server = null;
    assert.equal(await stagePptEngineBackup({ dataRoot: root, stage, port }), true);
    assert.equal(await readFile(path.join(stage, 'ppt-engine', 'uploads', 'project', 'pages', 'test.png'), 'utf8'), 'synthetic-image');
    await assert.rejects(readFile(path.join(stage, 'ppt-engine', 'instance', '.secretary-control-token')), { code: 'ENOENT' });
    const snapshot = new PrismaClient({ datasources: { db: { url: `file:${path.join(stage, 'ppt-engine', 'instance', 'database.db').replace(/\\/g, '/')}` } } });
    const rows = await snapshot.$queryRawUnsafe('SELECT status FROM tasks');
    await snapshot.$disconnect();
    assert.equal(rows[0].status, 'COMPLETED');
    const active = new PrismaClient({ datasources: { db: { url } } });
    await active.$executeRawUnsafe("UPDATE tasks SET status = 'PROCESSING'");
    await active.$disconnect();
    await assert.rejects(stagePptEngineBackup({ dataRoot: root, stage: path.join(temp, 'active'), port }), /未结束的任务/);
    assert.equal(await stagePptEngineBackup({ dataRoot: path.join(temp, 'missing'), stage, port }), false);
    const incomplete = path.join(temp, 'incomplete');
    await mkdir(incomplete);
    await assert.rejects(stagePptEngineBackup({ dataRoot: incomplete, stage, port }), /PPT 数据目录不完整/);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe temporary test directory');
    await rm(temp, { recursive: true, force: true });
  }
});
