import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionIsCurrent } from '@/lib/auth';
import { SANDBOX_CSP, downloadName, withShim } from '@/lib/pages';

/**
 * AI 生成的页面本体。详情页用 iframe 嵌它，「全屏打开」直接在新标签页开它。
 *
 * ⚠ 两种打开方式都必须是沙箱 —— 所以沙箱写在**响应头**上（CSP sandbox），
 * 不只写在 iframe 的属性上：直接开这个地址时没有 iframe，属性管不着。
 * 为什么必须沙箱，见 lib/pages.ts 顶上。
 *
 * `?download=1` 给原样的 HTML 当附件下载：不注入 SHIM（下载下来是普通网页，
 * 原生 alert、localStorage 都能用），也不带 CSP（离开了平台，就没什么可偷的了）。
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // 路由处理器不走 (app) 的 layout，登录态得自己再验一次，
  // 否则知道 id 就能绕过页面直接把内容取走
  if (!(await sessionIsCurrent())) return new NextResponse('未授权', { status: 401 });

  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, select: { title: true, html: true } });
  if (!page) return new NextResponse('页面不存在', { status: 404 });

  if (new URL(req.url).searchParams.get('download')) {
    const name = downloadName(page.title);
    return new NextResponse(page.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="page.html"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return new NextResponse(withShim(page.html), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': SANDBOX_CSP,
      // 页面改了刷新就该看到新的
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
