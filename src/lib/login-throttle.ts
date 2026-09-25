/**
 * 登录限流 —— 公网上这是唯一拦暴力破解的东西。
 *
 * 主平台没有这一层：`login` server action 每次 POST 试一个密码，
 * 不限次、不延迟、不锁定。内网下无所谓，公网下这就是主要攻击面。
 *
 * 两层：
 *   1. 递增延迟 —— 第 n 次失败等 2^n × 250ms（封顶 8 秒）。
 *      主人输错一两次最多等半秒，脚本跑字典直接变成不可行。
 *   2. 硬锁 —— 同一个来源连错 10 次，锁 15 分钟。
 *
 * 为什么按来源 IP 而不是全局：全局锁会让攻击者顺手把主人自己关在门外。
 * IP 可以轮换，所以硬锁只是兜底，真正起作用的是那个延迟 —— 它对
 * 每个新 IP 都从头计，但攻击者每换一次 IP 也只能试几次。
 *
 * 单实例内存存储。这一版就一个用户、一个进程，够用；将来要是上多实例，
 * 这里得换成 Redis，别忘了。
 */

type Attempt = { fails: number; lockedUntil: number; last: number };

const attempts = new Map<string, Attempt>();

const LOCK_THRESHOLD = 10;
const LOCK_MS = 15 * 60 * 1000;
/** 一小时没再失败就当没发生过，免得主人隔天登录还在还上次的债 */
const RESET_MS = 60 * 60 * 1000;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 8000;
/** Map 的上限，防止 IP 轮换把内存撑爆 */
const MAX_ENTRIES = 5000;

export type ThrottleVerdict =
  | { allowed: true; delayMs: number }
  | { allowed: false; retryAfterSec: number };

function prune(now: number) {
  if (attempts.size < MAX_ENTRIES) return;
  for (const [key, a] of attempts) {
    if (now - a.last > RESET_MS && a.lockedUntil < now) attempts.delete(key);
  }
  // 还是满的就整个清掉 —— 宁可放过，也不要因为内存爆掉而整站挂了
  if (attempts.size >= MAX_ENTRIES) attempts.clear();
}

/** 登录前问一句：这个来源现在能试吗？能的话该先等多久 */
export function checkThrottle(key: string): ThrottleVerdict {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a) return { allowed: true, delayMs: 0 };

  if (a.lockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((a.lockedUntil - now) / 1000) };
  }
  if (now - a.last > RESET_MS) {
    attempts.delete(key);
    return { allowed: true, delayMs: 0 };
  }
  return { allowed: true, delayMs: Math.min(BASE_DELAY_MS * 2 ** a.fails, MAX_DELAY_MS) };
}

/** 密码错了 */
export function recordFailure(key: string) {
  const now = Date.now();
  prune(now);
  const a = attempts.get(key) ?? { fails: 0, lockedUntil: 0, last: now };
  a.fails += 1;
  a.last = now;
  if (a.fails >= LOCK_THRESHOLD) a.lockedUntil = now + LOCK_MS;
  attempts.set(key, a);
}

/** 密码对了，清账 */
export function recordSuccess(key: string) {
  attempts.delete(key);
}

export function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/**
 * 从请求头认来源。经 nginx 反代时真实 IP 在 x-forwarded-for 的第一段。
 *
 * ⚠ 这个头是客户端可伪造的，除非反代覆盖它。部署时 nginx 必须写
 *   `proxy_set_header X-Forwarded-For $remote_addr;`（注意不是 $proxy_add_...，
 *   那个会把客户端自己塞的值也带上）。伪造的后果只是绕过硬锁，
 *   递增延迟仍然对每个伪造来源生效。
 */
export function clientKey(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return headers.get('x-real-ip') ?? 'unknown';
}
