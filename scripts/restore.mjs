#!/usr/bin/env node
/**
 * 从备份恢复
 *
 *   node scripts/restore.mjs                 列出所有备份
 *   node scripts/restore.mjs latest          解开最新一份
 *   node scripts/restore.mjs secretary-20260823-0930.enc
 *   node scripts/restore.mjs latest --to ./somewhere
 *
 * 只解到一个新目录，**不会**直接覆盖 data/ —— 恢复是低频高危操作，
 * 让人先看一眼再自己动手替换。
 */
import { createDecipheriv, scryptSync } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

// 显式加载 .env。不要依赖 Prisma 顺手加载的副作用 —— 动态 import Prisma 的
// 脚本会在读取环境变量时拿到 undefined，排查起来很费劲。
try {
  process.loadEnvFile();
} catch {
  // 没有 .env 就用系统环境变量
}


const run = promisify(execFile);
const MAGIC = 'AISECBK1';
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const target = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--to');
const BACKUP_DIR = process.env.BACKUP_DIR || 'G:/我的云端硬盘/backups/ai-secretary';

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function listBackups() {
  let files;
  try {
    files = await readdir(BACKUP_DIR);
  } catch {
    console.error(`备份目录不存在: ${BACKUP_DIR}`);
    process.exit(1);
  }
  const backups = files.filter((f) => /^secretary-\d{8}-\d{4}\.(enc|tar)$/.test(f)).sort().reverse();
  if (backups.length === 0) {
    console.log('还没有任何备份。跑 `npm run backup` 生成第一份。');
    return [];
  }
  console.log(`备份目录: ${BACKUP_DIR}\n`);
  for (const f of backups) {
    const s = await stat(path.join(BACKUP_DIR, f));
    const m = f.match(/^secretary-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
    const when = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
    const kind = f.endsWith('.enc') ? '加密' : '未加密';
    console.log(`  ${f}  (${when}, ${human(s.size)}, ${kind})`);
  }
  console.log(`\n共 ${backups.length} 份。恢复最新的: node scripts/restore.mjs latest`);
  return backups;
}

function decrypt(buf, passphrase) {
  if (buf.subarray(0, 8).toString() !== MAGIC) {
    throw new Error('文件头不对，不是本工具生成的备份');
  }
  const salt = buf.subarray(8, 24);
  const iv = buf.subarray(24, 36);
  const tag = buf.subarray(36, 52);
  const body = buf.subarray(52);

  const key = scryptSync(passphrase, salt, 32, SCRYPT);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(body), d.final()]);
  } catch {
    // GCM 校验失败要么是口令错，要么文件被改过 —— 两种都得说清楚
    throw new Error('解密失败：口令不对，或者备份文件已损坏');
  }
}

async function main() {
  if (!target) return void (await listBackups());

  const backups = (await readdir(BACKUP_DIR))
    .filter((f) => /^secretary-\d{8}-\d{4}\.(enc|tar)$/.test(f))
    .sort()
    .reverse();
  const name = target === 'latest' ? backups[0] : target;
  if (!name) throw new Error('没有可用的备份');

  const src = path.join(BACKUP_DIR, name);
  const buf = await readFile(src);

  let tarBuf;
  if (name.endsWith('.enc')) {
    const passphrase = process.env.BACKUP_PASSPHRASE || flag('passphrase');
    if (!passphrase) {
      throw new Error(
        '需要口令。.env 里没有 BACKUP_PASSPHRASE 时，用 --passphrase "你的口令" 传入'
      );
    }
    tarBuf = decrypt(buf, passphrase);
  } else {
    tarBuf = buf;
  }

  const stampMatch = name.match(/(\d{8}-\d{4})/);
  const dest = path.resolve(flag('to', `./restored-${stampMatch ? stampMatch[1] : 'backup'}`));
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  // 同样用 cwd + 相对路径，绕开 GNU tar 把盘符冒号当远程主机的问题
  const tmpTar = path.join(dest, '_restore.tar');
  await writeFile(tmpTar, tarBuf);
  await run('tar', ['-xf', '_restore.tar'], { cwd: dest });
  await rm(tmpTar, { force: true });

  console.log(`已恢复到: ${dest}`);
  console.log(`  来源: ${name}`);

  // 顺手报一下里面有多少东西，免得恢复了个空壳还不知道
  try {
    const { PrismaClient } = await import('@prisma/client');
    const dbPath = path.join(dest, 'secretary.db').replace(/\\/g, '/');
    const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
    const counts = {
      资料: await db.vaultItem.count(),
      记录: await db.message.count(),
      任务: await db.task.count(),
      文件: await db.attachment.count(),
    };
    await db.$disconnect();
    console.log(`  内容: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  } catch {
    console.log('  （无法读取数据库统计，但文件已解出，可自行查看）');
  }

  console.log(`\n确认无误后，把 ${path.basename(dest)}/ 下的 secretary.db、uploads/ 和 *.json 复制回 data/。`);
}

main().catch((e) => {
  console.error('恢复失败:', e.message);
  process.exit(1);
});
