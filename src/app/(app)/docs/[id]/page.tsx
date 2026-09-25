import { db } from '@/lib/db';
import Prose from '@/components/Prose';
import CopyDoc from '@/components/CopyDoc';
import { formatDate } from '@/lib/format';
import { humanSize } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function DocPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;

  /**
   * 返回按钮去哪，由来路决定。
   *
   * 起因：任务卡片点进来看文稿，左上角返回却跳到了文稿列表 —— 因为这个页面
   * 原来只有一个来路。现在任务页带 ?from= 过来，而且带的是**当前筛选后的那一屏**
   * （比如 /tasks?o=代办人），退回去正好还在代办人那一栏，不用重新筛一遍。
   *
   * 只认站内路径：必须以单个 / 开头 —— 挡掉 //evil.com 这种协议相对网址。
   */
  const safeFrom = from && /^\/(?!\/)/.test(from) ? from : null;
  const backTo = safeFrom ?? '/docs';
  const backLabel = safeFrom?.startsWith('/tasks') ? '返回任务' : '返回文稿列表';
  const doc = await db.document.findUnique({ where: { id }, include: { attachments: true } });
  if (!doc) notFound();

  const tags = doc.tags?.split(',').map((t) => t.trim()).filter(Boolean) ?? [];

  return (
    <>
      <header
        className="sticky top-0 z-20 surface border-b pt-safe"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-1 px-2 h-14">
          <Link
            href={backTo}
            className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full active:opacity-60"
            aria-label={backLabel}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <p className="text-sm font-medium truncate">{doc.title}</p>
        </div>
      </header>

      <article className="px-4 pt-6 pb-8">
        <h1 className="text-[21px] font-semibold leading-snug">{doc.title}</h1>

        <div className="muted text-xs mt-2.5 leading-relaxed space-y-0.5">
          {doc.occasion && <p>{doc.occasion}</p>}
          <p>
            {doc.date && formatDate(doc.date)}
            {doc.category && `${doc.date ? ' · ' : ''}${doc.category}`}
            {` · ${doc.body.length.toLocaleString('zh-CN')} 字`}
          </p>
        </div>

        <CopyDoc body={doc.body} title={doc.title} />

        <hr className="my-6 border-0 border-t" style={{ borderColor: 'var(--border)' }} />

        <Prose>{doc.body}</Prose>

        {doc.attachments.length > 0 && (
          <div className="mt-10 space-y-2">
            <p className="muted text-[11px]">附件</p>
            {doc.attachments.map((a) => (
              <a
                key={a.id}
                href={`/api/files/${a.id}`}
                target="_blank"
                className="flex items-center gap-3 surface border rounded-2xl p-3 active:opacity-70 transition"
                style={{ borderColor: 'var(--border)' }}
              >
                <div
                  className="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--bg)' }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4.5 w-4.5 muted"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm break-all">{a.filename}</p>
                  <p className="muted text-[11px]">{humanSize(a.size)}</p>
                </div>
              </a>
            ))}
          </div>
        )}

        {tags.length > 0 && (
          <div className="mt-10 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="muted text-[11px] px-2 py-1 rounded-md"
                style={{ background: 'var(--bg)' }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {doc.sourcePath && (
          <p className="muted text-[11px] mt-6 break-all">源文件：{doc.sourcePath}</p>
        )}
      </article>
    </>
  );
}
