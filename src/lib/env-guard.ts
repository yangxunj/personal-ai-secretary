/**
 * 公网版的鉴权配置检查 —— 配置不全就拒绝服务，绝不降级放行。
 *
 * 起因：主平台的 middleware 写的是 `process.env.SESSION_SECRET ?? ''`。
 * secret 忘了设，`verifySessionValue` 拿到空串照样 importKey、照样算 HMAC ——
 * 登录页正常显示，但任何人都能用空密钥自己造一个合法 cookie 直接进来。
 * 内网下无所谓（Tailscale 兜着），公网下这就是全部隐私数据敞开。
 *
 * 所以这一版反过来：缺一样就整站 503，宁可白屏也不要假装有防线。
 *
 * Edge runtime 里也要跑，所以只用 process.env 和字符串操作，不碰 node:crypto。
 */

export type EnvProblem = { key: string; reason: string };

/** session 密钥的最短长度。32 字节 hex = 64 字符，短于这个多半是随手填的 */
const MIN_SECRET_LENGTH = 32;

/**
 * 检查登录相关的环境变量。返回空数组表示可以放行。
 *
 * 本地调试想关掉登录，必须显式设 ALLOW_INSECURE_LOCAL=true ——
 * 让「关掉防线」这件事只能是故意的，不可能是手滑。
 */
export function checkAuthEnv(env: Record<string, string | undefined> = process.env): EnvProblem[] {
  if (env.ALLOW_INSECURE_LOCAL === 'true') return [];

  const problems: EnvProblem[] = [];

  if (env.AUTH_ENABLED !== 'true') {
    problems.push({
      key: 'AUTH_ENABLED',
      reason: '公网版必须是 "true"。真要在本地关掉，设 ALLOW_INSECURE_LOCAL="true"',
    });
  }

  const secret = env.SESSION_SECRET ?? '';
  if (!secret) {
    problems.push({
      key: 'SESSION_SECRET',
      reason: '没有设置。空密钥意味着任何人都能伪造登录 cookie',
    });
  } else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push({
      key: 'SESSION_SECRET',
      reason: `只有 ${secret.length} 个字符，至少要 ${MIN_SECRET_LENGTH} 个。用 randomBytes(32).toString("hex") 生成`,
    });
  }

  const hash = env.APP_PASSWORD_HASH ?? '';
  if (!hash) {
    problems.push({
      key: 'APP_PASSWORD_HASH',
      reason: '没有设置密码。跑 node scripts/set-password.mjs <密码>',
    });
  } else if (!hash.includes(':')) {
    problems.push({
      key: 'APP_PASSWORD_HASH',
      reason: '格式不对，应该是 salt:hash。重新跑一次 set-password.mjs',
    });
  }

  return problems;
}

/** 配置不全时给出的页面。故意不套样式 —— 这时候连数据库都不该碰 */
export function renderConfigError(problems: EnvProblem[]): string {
  const items = problems
    .map((p) => `<li><code>${p.key}</code> —— ${p.reason}</li>`)
    .join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>配置未完成</title></head>
<body style="font:16px/1.7 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1.5rem">
<h1 style="font-size:1.25rem">服务未启动：登录配置不完整</h1>
<p>为避免在没有防线的情况下暴露隐私数据，本站拒绝提供服务。请补全 <code>.env</code>：</p>
<ul>${items}</ul>
<p style="color:#666;font-size:.9rem">改完 <code>.env</code> 后需要重启服务（<code>npm run build &amp;&amp; npm start</code>）。</p>
</body></html>`;
}
