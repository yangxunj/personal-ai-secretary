import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionValue } from '@/lib/session-edge';
import { checkAuthEnv, renderConfigError } from '@/lib/env-guard';
import { SESSION_COOKIE } from '@/lib/instance';

/** 只有登录页本身可以匿名访问。用全等而不是 startsWith —— 后者连 /login-xxx 都放行 */
const PUBLIC_PATHS = new Set(['/login']);

export async function middleware(req: NextRequest) {
  // 配置不全 → 整站 503。这一版跑在公网上，没有内网兜底，
  // 绝不能像主平台那样 secret 缺失就拿空字符串接着算 HMAC。
  const problems = checkAuthEnv();
  if (problems.length) {
    return new NextResponse(renderConfigError(problems), {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  // 显式放行的本地不安全模式（ALLOW_INSECURE_LOCAL），checkAuthEnv 已经放过了
  if (process.env.AUTH_ENABLED !== 'true') return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const ok = await verifySessionValue(
    req.cookies.get(SESSION_COOKIE)?.value,
    process.env.SESSION_SECRET ?? ''
  );
  if (ok) return NextResponse.next();

  // **不能直接 redirect(req.nextUrl)。**
  //
  // `req.nextUrl` 的 origin 是 Next 自己的监听地址（localhost:3091），不是
  // 客户端请求的那个。照抄就会把内部地址发给浏览器 —— 用户点开
  // https://<公网IP>:3443/ 被踢到 https://localhost:3091/login，整站进不去。
  //
  // 相对 Location 也不行：Next 内部拿 `new URL(location)` 解析 middleware
  // 的响应头，相对路径直接 ERR_INVALID_URL，整站 500。
  //
  // 所以从请求头把 origin 拼回来。**`Host` 必须是 nginx 里的 `$http_host`**
  // （原样带端口），`$host` 会把 `:3443` 吃掉，跳到 443 上去。
  const host =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const proto =
    req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');

  const url = new URL('/login', `${proto}://${host}`);
  url.searchParams.set('from', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // 放行静态资源，其余全部需要登录
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg).*)'],
};
