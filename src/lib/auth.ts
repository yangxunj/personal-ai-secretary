import { scryptSync, timingSafeEqual, randomBytes, createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/instance';

// 名字随实例变（生产 / 测试各一个），原因见 instance.ts。
// 继续从这儿再导出一次：原来 SESSION_COOKIE 就定义在这个文件里，
// 别的地方都是从 auth 引的，不留这行会散着改一片。
export { SESSION_COOKIE };
const MAX_AGE = 60 * 60 * 24 * 30; // 30 天

const PASSWORD_KEY = 'auth.passwordHash';
const VERSION_KEY = 'auth.pwVersion';

/** 新密码的最低长度。这东西挂在公网上，别让人随手设个 4 位 */
export const MIN_PASSWORD_LENGTH = 8;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('缺少 SESSION_SECRET 环境变量');
  return s;
}

// ---------- 密码 ----------

/** 生成 `salt:hash` 形式的 scrypt 哈希 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(plain, salt, 64).toString('hex')}`;
}

/** 拿一个明文跟一个 `salt:hash` 比对 */
export function matchesHash(plain: string, stored: string): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  if (!expected.length) return false;
  const actual = scryptSync(plain, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * 当前生效的密码哈希。
 *
 * 数据库里有就用数据库的（使用者自己改过的）；没有就拿 `.env` 里那个当**初始
 * 密码**，并顺手落库 —— 之后 `.env` 那行就只是个历史痕迹，改它不再有任何作用。
 *
 * 这一步的意义：交付出去的系统，密码不能永远是开发者设的那个。
 */
export async function currentPasswordHash(): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: PASSWORD_KEY } });
  if (row?.value) return row.value;

  const seed = process.env.APP_PASSWORD_HASH ?? '';
  if (seed.includes(':')) {
    await db.setting.upsert({
      where: { key: PASSWORD_KEY },
      create: { key: PASSWORD_KEY, value: seed },
      update: {}, // 并发时别覆盖已经写进去的
    });
  }
  return seed;
}

/**
 * 密码版本号。每改一次密码 +1，写进 session。
 *
 * 用来让**旧 session 失效**：改密码的动机通常是「密码可能泄露了」，
 * 那别人手里那张 30 天有效的 cookie 就必须当场作废，否则改了等于没改。
 */
export async function currentPwVersion(): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: VERSION_KEY } });
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function verifyPassword(input: string): Promise<boolean> {
  return matchesHash(input, await currentPasswordHash());
}

export type ChangeResult = { ok: true } | { ok: false; error: string };

/** 改密码：验旧的 → 写新的 → 版本号 +1（旧 session 随即失效） */
export async function changePassword(oldPw: string, newPw: string): Promise<ChangeResult> {
  if (!(await verifyPassword(oldPw))) return { ok: false, error: '当前密码不对' };
  if (newPw.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `新密码至少 ${MIN_PASSWORD_LENGTH} 位` };
  }
  if (newPw === oldPw) return { ok: false, error: '新密码跟当前密码一样' };

  const next = hashPassword(newPw);
  const version = String((await currentPwVersion()) + 1);
  await db.$transaction([
    db.setting.upsert({
      where: { key: PASSWORD_KEY },
      create: { key: PASSWORD_KEY, value: next },
      update: { value: next },
    }),
    db.setting.upsert({
      where: { key: VERSION_KEY },
      create: { key: VERSION_KEY, value: version },
      update: { value: version },
    }),
  ]);
  return { ok: true };
}

// ---------- session ----------

/** 签名后的 session 值：payload.signature */
export function signSession(expiresAt: number, pwv: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt, pwv })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export async function createSession() {
  const exp = Date.now() + MAX_AGE * 1000;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signSession(exp, await currentPwVersion()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE,
    path: '/',
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * 这张 cookie 是不是当前密码签发的。
 *
 * **签名和过期由 middleware 验**（Edge runtime，只有 Web Crypto）；
 * 版本号只能在这里验 —— middleware 读不到数据库。所以走到 Node 这一侧的
 * 每个入口（页面 layout、API 路由）都要叫一次它，否则改完密码，旧 cookie
 * 页面进不去、直接打 API 却还能用。
 */
export async function sessionIsCurrent(): Promise<boolean> {
  if (process.env.AUTH_ENABLED !== 'true') return true;

  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(raw.split('.')[0], 'base64url').toString('utf8')
    ) as { exp?: number; pwv?: number };
    // 老 cookie（没有 pwv 字段）按版本 1 算，不至于把改密码前登录的人踢出去
    return (payload.pwv ?? 1) === (await currentPwVersion());
  } catch {
    return false;
  }
}
