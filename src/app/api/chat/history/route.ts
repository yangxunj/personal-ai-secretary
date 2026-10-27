import { db } from '@/lib/db';
import { sessionIsCurrent } from '@/lib/auth';
import { displayPage, displayOrder, parseDisplayCursor } from '@/lib/chat-display-history';

export const dynamic = 'force-dynamic';

/** 只同步消息，避免新对话的路由刷新卸载仍在运行的语音组件。 */
export async function GET(req: Request) {
  if (!(await sessionIsCurrent())) return new Response('Unauthorized', { status: 401 });
  const params = new URL(req.url).searchParams;
  const conversationId = params.get('conversationId') || '';
  if (!/^(legacy|[a-z0-9]{20,40})$/.test(conversationId)) return new Response('Invalid conversation', { status: 400 });
  if (params.get('page') === 'older') {
    let anchor;
    try { anchor = params.has('before') ? parseDisplayCursor(params.get('before')!, conversationId) : undefined; }
    catch { return new Response('Invalid cursor', { status: 400 }); }
    return Response.json(await displayPage(conversationId, anchor), { headers: { 'Cache-Control': 'no-store' } });
  }
  const take = Math.min(2000, Math.max(60, Math.floor(Number(params.get('take')) || 60)));
  const rows = await db.message.findMany({ where: { conversationId }, orderBy: displayOrder, take,
    select: { id: true, role: true, content: true, createdAt: true,
      attachments: { select: { id: true, filename: true, size: true } },
      task: { select: { id: true, title: true } } } });
  return Response.json(rows.reverse(), { headers: { 'Cache-Control': 'no-store' } });
}
