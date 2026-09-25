#!/usr/bin/env node
/**
 * 备份到 Google Drive（加密）
 *
 * 用法: node scripts/backup.mjs [--keep 30] [--plain]
 *
 * 为什么不能把 data/ 直接放进同步文件夹：SQLite 在写入过程中被同步走，
 * 拿到的可能是损坏的半截文件。所以先用 VACUUM INTO 生成一致性快照，
 * 再打包加密送出去。
 *
 * 加密：AES-256-GCM，密钥用 scrypt 从 .env 里的 BACKUP_PASSPHRASE 派生。
 * 格式见备份目录下自动生成的 恢复说明.md —— 那份文档保证即使这个项目
 * 全部丢失，凭口令也能把数据还原出来。
 */
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, rm, cp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

// 显式加载 .env。不要依赖 Prisma 顺手加载的副作用 —— 动态 import Prisma 的
// 脚本会在读取环境变量时拿到 undefined，排查起来很费劲。
try {
  process.loadEnvFile();
} catch {
  // 没有 .env 就用系统环境变量
}


const run = promisify(execFile);

const MAGIC = Buffer.from('AISECBK1'); // 8 字节，用来认文件和版本
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';
const BACKUP_DIR = process.env.BACKUP_DIR || 'G:/我的云端硬盘/backups/ai-secretary';
const KEEP = Number(flag('keep', 30));
const PLAIN = has('plain');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function encrypt(plain, passphrase) {
  const salt = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32, SCRYPT);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  // MAGIC(8) | salt(16) | iv(12) | authTag(16) | 密文
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

/** 保留最近 KEEP 份，更早的删掉 */
async function rotate() {
  const files = (await readdir(BACKUP_DIR))
    .filter((f) => /^secretary-\d{8}-\d{4}\.(enc|tar)$/.test(f))
    .sort()
    .reverse();
  const stale = files.slice(KEEP);
  for (const f of stale) await rm(path.join(BACKUP_DIR, f), { force: true });
  return { kept: Math.min(files.length, KEEP), removed: stale.length };
}

async function writeRecoveryDoc() {
  const doc = `# 如何从这些备份恢复数据

每个 \`secretary-<日期>-<时间>.enc\` 都是一份完整快照，包含数据库和全部文件。
**不需要按顺序恢复，任取一份即可。**

## 正常情况

在 ai-secretary 项目目录下：

\`\`\`bash
node scripts/restore.mjs            # 列出所有备份
node scripts/restore.mjs latest     # 解开最新一份到 restored-<时间戳>/
\`\`\`

确认内容无误后，把里面的 \`secretary.db\`、\`uploads/\` 和那几个 \`.json\`（邮件台账、待缴账单）复制回项目的 \`data/\`。

## 万一项目本身也没了

备份文件是自包含的，只要有 Node 和口令就能解开。把下面这段存成
\`recover.mjs\`，运行 \`node recover.mjs <备份文件> <口令>\`：

\`\`\`js
import { createDecipheriv, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [file, passphrase] = process.argv.slice(2);
const buf = readFileSync(file);
if (buf.subarray(0, 8).toString() !== 'AISECBK1') throw new Error('不是本工具生成的备份');

const salt = buf.subarray(8, 24);
const iv   = buf.subarray(24, 36);
const tag  = buf.subarray(36, 52);
const body = buf.subarray(52);

const key = scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 134217728 });
const d = createDecipheriv('aes-256-gcm', key, iv);
d.setAuthTag(tag);
writeFileSync('recovered.tar', Buffer.concat([d.update(body), d.final()]));
console.log('已解密为 recovered.tar，用 tar -xf recovered.tar 解开');
\`\`\`

解出来的 \`recovered.tar\` 是标准 tar 包，任何解压工具都能打开，里面是
\`secretary.db\`（标准 SQLite 文件，可用任意 SQLite 工具查看）和 \`uploads/\`。

## 加密参数

| 项目 | 值 |
| --- | --- |
| 算法 | AES-256-GCM |
| 密钥派生 | scrypt，N=32768 r=8 p=1，输出 32 字节 |
| 文件结构 | magic \`AISECBK1\`(8) + salt(16) + iv(12) + authTag(16) + 密文 |

## 口令

口令存在项目的 \`.env\` 里（\`BACKUP_PASSPHRASE\`），那个文件不进 git。
**如果这台电脑坏了，\`.env\` 也就没了 —— 所以口令务必另外记住一份。**
`;
  await writeFile(path.join(BACKUP_DIR, '恢复说明.md'), doc, 'utf8');
}

async function main() {
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!PLAIN && !passphrase) {
    console.error(
      '缺少 BACKUP_PASSPHRASE。先设置口令：\n' +
        '  node scripts/set-backup-key.mjs "你的口令"\n' +
        '或者用 --plain 生成不加密的备份（不建议放进云盘）。'
    );
    process.exit(1);
  }

  const tag = stamp();
  const stage = path.resolve('.backup-stage');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await mkdir(BACKUP_DIR, { recursive: true });

  // 1. 数据库一致性快照（不能直接复制文件，写入中途会拿到半截数据）
  const db = new PrismaClient();
  const snapshot = path.join(stage, 'secretary.db').replace(/\\/g, '/');
  await db.$executeRawUnsafe(`VACUUM INTO '${snapshot}'`);
  const counts = {
    资料: await db.vaultItem.count(),
    记录: await db.message.count(),
    任务: await db.task.count(),
    文件: await db.attachment.count(),
  };
  await db.$disconnect();

  // 2. 上传的文件一起打包
  await cp(path.resolve(UPLOAD_DIR), path.join(stage, 'uploads'), { recursive: true });

  // 2b. data/ 根目录下那几个 JSON —— 邮件扫描台账、待缴账单。
  //     它们**既不在 git 里（data/ 被忽略），原来也不在备份里**，丢了就真没了。
  //     里面是我攒下来的工作状态（扫到哪天、哪些邮件处理过、哪些账单没缴），
  //     重建的成本比数据库还高：数据库能从月结单重导，这些只能重新翻一遍邮箱。
  //     .thumbs/ 不收 —— 那个删了随时能再生成。
  const extras = [];
  for (const name of await readdir(path.resolve('data'))) {
    if (!name.endsWith('.json')) continue;
    await cp(path.resolve('data', name), path.join(stage, name));
    extras.push(name);
  }

  // 3. 打成标准 tar —— 最坏情况下用任何解压工具都能打开
  //    注意：路径一律用 cwd + 相对路径。GNU tar 会把 "C:\..." 里的冒号
  //    当成远程主机分隔符，直接报 "Cannot connect to C"。
  const tarName = `secretary-${tag}.tar`;
  await run('tar', ['-cf', tarName, 'secretary.db', 'uploads', ...extras], { cwd: stage });
  const tarBuf = await readFile(path.join(stage, tarName));

  // 4. 加密后送进 Google Drive
  const ext = PLAIN ? 'tar' : 'enc';
  const out = path.join(BACKUP_DIR, `secretary-${tag}.${ext}`);
  await writeFile(out, PLAIN ? tarBuf : encrypt(tarBuf, passphrase));

  await writeRecoveryDoc();
  await rm(stage, { recursive: true, force: true });

  const size = (await stat(out)).size;
  const { kept, removed } = await rotate();

  console.log(`备份完成: ${out}`);
  console.log(`  ${PLAIN ? '未加密' : 'AES-256-GCM 加密'} · ${human(size)}`);
  console.log(`  内容: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  保留 ${kept} 份${removed ? `，清理了 ${removed} 份旧的` : ''}`);
}

main().catch((e) => {
  console.error('备份失败:', e.message);
  process.exit(1);
});
