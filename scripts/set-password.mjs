#!/usr/bin/env node
/**
 * 设置 / 重置登录密码：node scripts/set-password.mjs <新密码>
 *
 * **写数据库，不写 .env。** 密码从 .env 搬进 `Setting` 表之后，`.env` 里那行
 * 只是「首次启动的初始密码」—— 库里一旦有了值，改 .env 再也不起作用。
 *
 * 这个脚本的用途是**救援**：使用者在网页上忘了密码进不来，搭系统的人 SSH
 * 上去跑一次。顺手把密码版本号 +1，所有旧 session 当场作废 ——
 * 密码都得重置了，之前登录的那些也不该还留着。
 *
 * 在服务器上要以能读写 data/ 的身份跑：
 *   cd /opt/ai-secretary && sudo -u secretary node scripts/set-password.mjs "<新密码>"
 */
import { scryptSync, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const MIN_LENGTH = 8;
const PASSWORD_KEY = 'auth.passwordHash';
const VERSION_KEY = 'auth.pwVersion';

const pwd = process.argv[2];
if (!pwd) {
  console.error('用法: node scripts/set-password.mjs <新密码>');
  process.exit(1);
}
if (pwd.length < MIN_LENGTH) {
  console.error(`密码太短，至少 ${MIN_LENGTH} 位。这东西挂在公网上。`);
  process.exit(1);
}

// 显式加载 .env：动态 import Prisma 的脚本拿不到 DATABASE_URL
try {
  process.loadEnvFile();
} catch {
  // 没有 .env 就用系统环境变量
}

const salt = randomBytes(16).toString('hex');
const value = `${salt}:${scryptSync(pwd, salt, 64).toString('hex')}`;

const db = new PrismaClient();
try {
  const current = await db.setting.findUnique({ where: { key: VERSION_KEY } });
  const version = String((Number(current?.value) || 1) + 1);

  await db.$transaction([
    db.setting.upsert({
      where: { key: PASSWORD_KEY },
      create: { key: PASSWORD_KEY, value },
      update: { value },
    }),
    db.setting.upsert({
      where: { key: VERSION_KEY },
      create: { key: VERSION_KEY, value: version },
      update: { value: version },
    }),
  ]);

  console.log('✅ 密码已更新，立即生效，不用重启服务。');
  console.log('   所有设备上已登录的 session 都已作废，要用新密码重新登录。');
} finally {
  await db.$disconnect();
}
