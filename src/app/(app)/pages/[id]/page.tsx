import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import { formatTime } from '@/lib/format';
import { PAGE_KINDS, type PageKind } from '@/lib/pages';
import PageManage from './PageManage';

export const dynamic = 'force-dynamic';

export default async function PageDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({
    where: { id },
    include: { versions: { orderBy: { createdAt: 'desc' }, select: { id: true, title: true, createdAt: true } } },
  });
  if (!page) notFound();

  // 在哪个对话里做的（Page.conversationId 没挂外键：对话删了页面照样留着）
  const from = page.conversationId
    ? await db.conversation.findUnique({ where: { id: page.conversationId }, select: { id: true, title: true } })
    : null;

  const raw = `/pages/${page.id}/raw`;
  // 数据快照才有「最新数据」可言；贪吃蛇重新生成只会得到另一条贪吃蛇
  const regenerate =
    page.kind === 'snapshot' && page.request
      ? `/chat?draft=${encodeURIComponent(
          `按最新数据重新生成页面「${page.title}」（id: ${page.id}），原来的要求是：${page.request}`,
        )}`
      : null;

  // 在它基础上改：详情页上最该有的下一步。示例页尤其 —— 看完「原来能做这个」，
  // 下一个念头就是「给我家也改一个」
  const tweak = `/chat?draft=${encodeURIComponent(`把页面「${page.title}」（id: ${page.id}）改一下：`)}`;

  const btn = 'text-xs px-2.5 py-1.5 rounded-lg border whitespace-nowrap active:opacity-60 hover:border-brand-500 transition';

  return (
    <div data-wide>
      <PageHeader
        back="/pages"
        title={page.title}
        subtitle={
          page.sample
            ? `示例 · ${page.sample}`
            : `${PAGE_KINDS[page.kind as PageKind] ?? page.kind} · ${formatTime(page.updatedAt)} 更新`
        }
        action={
          <div className="flex items-center gap-1.5">
            {regenerate && (
              <Link href={regenerate} className={`${btn} hidden sm:inline-block`} style={{ borderColor: 'var(--border)' }}>
                用最新数据重做
              </Link>
            )}
            <a href={raw} target="_blank" rel="noopener" className={btn} style={{ borderColor: 'var(--border)' }}>
              全屏
            </a>
            <a href={`${raw}?download=1`} className={btn} style={{ borderColor: 'var(--border)' }}>
              下载
            </a>
          </div>
        }
      />

      {/* sandbox 不带 allow-same-origin：页面里的脚本拿不到平台的任何东西。
          响应头上也有一道同样的 CSP，这里是第二道 —— 见 lib/pages.ts。
          ?v= 让改版后的页面不吃浏览器缓存 */}
      <iframe
        src={`${raw}?v=${page.updatedAt.getTime()}`}
        title={page.title}
        sandbox="allow-scripts allow-downloads"
        className="block w-full border-0 h-[calc(100dvh-3.5rem-4.25rem)] lg:h-[calc(100dvh-3.5rem)]"
      />

      <div className="px-4 py-5 max-w-2xl space-y-4">
        {page.summary && <p className="muted text-sm leading-relaxed">{page.summary}</p>}
        {page.request && (
          <p className="text-[12px] leading-relaxed muted">
            <span className="font-medium">{page.sample ? '在对话里这样说就能做出来：' : '当初的要求：'}</span>
            {page.sample ? `「${page.request}」` : page.request}
          </p>
        )}
        <Link
          href={tweak}
          className="inline-block text-[13px] px-3.5 py-2 rounded-xl bg-brand-500 text-white active:opacity-80"
        >
          {page.sample ? '照这个改一个自己的' : '在对话里改它'}
        </Link>
        {regenerate && (
          <Link href={regenerate} className={`${btn} inline-block sm:hidden`} style={{ borderColor: 'var(--border)' }}>
            用最新数据重做
          </Link>
        )}
        {from && (
          <p className="muted text-[12px] leading-relaxed">
            做它的那个对话：
            <Link href={`/chat/${from.id}`} className="text-brand-600 dark:text-brand-300 underline underline-offset-2">
              {from.title ?? '没起标题的对话'}
            </Link>
          </p>
        )}
        <PageManage
          id={page.id}
          versions={page.versions.map((v) => ({ id: v.id, title: v.title, at: formatTime(v.createdAt) }))}
        />
      </div>
    </div>
  );
}
