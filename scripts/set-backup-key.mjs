#!/usr/bin/env node
/**
 * 设置备份口令：node scripts/set-backup-key.mjs "你的口令"
 *
 * 口令以明文存进 .env（那个文件不进 git）—— 因为要用它派生解密密钥，
 * 存哈希是没法解密的。
 *
 * 重要：.env 和数据库在同一台电脑上。这台电脑坏了两者一起没，云端备份
 * 就永远打不开了。所以口令一定要另外记住一份 —— 用一句你记得住的话，
 * 或者存进密码管理器。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const passphrase = process.argv[2];
if (!passphrase) {
  console.error('用法: node scripts/set-backup-key.mjs "你的口令"');
  process.exit(1);
}
if (passphrase.length < 8) {
  console.error('口令太短了，至少 8 个字符。建议用一句话，比过短的随机串更好记也更难猜。');
  process.exit(1);
}

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

const line = `BACKUP_PASSPHRASE="${passphrase.replace(/"/g, '\\"')}"`;
if (/^BACKUP_PASSPHRASE=.*$/m.test(env)) {
  env = env.replace(/^BACKUP_PASSPHRASE=.*$/m, line);
  console.log('备份口令已更新。');
  console.log('注意：用旧口令加密的历史备份，只能用旧口令解开 —— 别把旧口令忘了。');
} else {
  env += (env.endsWith('\n') || env === '' ? '' : '\n') + line + '\n';
  console.log('备份口令已设置。');
}
writeFileSync(envPath, env);

console.log('');
console.log('请务必把这个口令另外记一份（密码管理器，或者选一句你不会忘的话）。');
console.log('这台电脑坏了的话，.env 会跟着没，届时只能靠你记得的口令解开云端备份。');
