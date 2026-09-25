import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifySessionValue } from '@/lib/session-edge';
import { SESSION_COOKIE } from '@/lib/instance';
import { cookies } from 'next/headers';

/**
 * 专题的呈现页 —— 把 `Topic.page` 里那整段 HTML 原样吐出来。
 *
 * 为什么不走附件：附件是 `file:add`，改一次多一条记录、换一个新 id，
 * 主人加的书签就失效了。存进数据库之后地址固定成 `/topics/<id>/page`，
 * 更新就是一次 UPDATE，书签和主屏幕图标一直有效。
 *
 * 这里是路由处理器，不套 `(app)` 的布局，所以打开就是干净的整页 ——
 * 没有底栏挤占，报告类的长页面正需要这样。
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // 跟 /api/files 一致：启用鉴权时这里也要单独校验一次，
  // 否则知道 id 就能绕过页面直接把内容取走。
  if (process.env.AUTH_ENABLED === 'true') {
    const jar = await cookies();
    const ok = await verifySessionValue(
      jar.get(SESSION_COOKIE)?.value,
      process.env.SESSION_SECRET ?? ''
    );
    if (!ok) return new NextResponse('未授权', { status: 401 });
  }

  const { id } = await params;
  const topic = await db.topic.findUnique({ where: { id }, select: { page: true, title: true } });
  if (!topic) return new NextResponse('专题不存在', { status: 404 });
  if (!topic.page) {
    return new NextResponse(`「${topic.title}」还没有呈现页`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new NextResponse(topic.page, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 内容会随专题更新而变，不能缓存 —— 主人刷新就该看到新的
      'Cache-Control': 'no-store',
    },
  });
}
