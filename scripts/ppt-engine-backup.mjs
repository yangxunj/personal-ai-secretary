import net from 'node:net';
import path from 'node:path';
import { cp, mkdir, stat } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

async function exists(p) {
  try { return await stat(p); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function portIsOpen(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('无法确定 PPT 引擎是否已停止')); });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(new Error('无法确定 PPT 引擎是否已停止'));
    });
  });
}

/** Fail before backup staging if a managed engine is running or a task is unfinished. */
export async function checkPptEngineBackup({ dataRoot, port = 15398 }) {
  const root = path.resolve(dataRoot);
  const rootStat = await exists(root);
  if (!rootStat) return null;
  if (!rootStat.isDirectory()) throw new Error('PPT 数据路径不是目录');
  const database = path.join(root, 'instance', 'database.db');
  const uploads = path.join(root, 'uploads');
  if (!(await exists(database))?.isFile() || !(await exists(uploads))?.isDirectory()) {
    throw new Error('PPT 数据目录不完整，备份已停止，避免遗漏文件');
  }
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) throw new Error('PPT 引擎端口无效');
  if (await portIsOpen(parsedPort)) throw new Error('请先停止 PPT 引擎并等待任务结束，再运行备份');
  const sqlitePath = database.replace(/\\/g, '/');
  const db = new PrismaClient({ datasources: { db: { url: `file:${sqlitePath}` } } });
  try {
    const rows = await db.$queryRawUnsafe("SELECT COUNT(*) AS count FROM tasks WHERE status IN ('PENDING', 'PROCESSING', 'RUNNING')");
    if (Number(rows[0]?.count || 0) > 0) throw new Error('PPT 数据库中还有未结束的任务，请先处理后再备份');
  } finally { await db.$disconnect(); }
  return { database, uploads, parsedPort };
}

/** The managed engine must remain stopped throughout the snapshot and file copy. */
export async function stagePptEngineBackup({ dataRoot, stage, port = 15398 }) {
  const source = await checkPptEngineBackup({ dataRoot, port });
  if (!source) return false;
  const { database, uploads, parsedPort } = source;
  const destination = path.join(stage, 'ppt-engine');
  await mkdir(path.join(destination, 'instance'), { recursive: true });
  const sqlitePath = database.replace(/\\/g, '/');
  const snapshot = path.join(destination, 'instance', 'database.db').replace(/\\/g, '/');
  const db = new PrismaClient({ datasources: { db: { url: `file:${sqlitePath}` } } });
  try { await db.$executeRawUnsafe(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`); }
  finally { await db.$disconnect(); }
  await cp(uploads, path.join(destination, 'uploads'), { recursive: true, dereference: false });
  if (await portIsOpen(parsedPort)) throw new Error('PPT 引擎在备份期间启动，请停止后重新备份');
  return true;
}
