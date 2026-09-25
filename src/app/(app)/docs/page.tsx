import { db } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import { formatDate } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DocsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;

  const docs = await db.document.findMany({
    where: c ? { category: c } : {},
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: { attachments: { select: { id: true } } },
  });

  const cats = await db.document.groupBy({ by: ['category'], _count: true });
  const totalChars = docs.reduce((s, d) => s + d.body.length, 0);

  return (
    <>
      <PageHeader
        title="文稿"
        subtitle={docs.length > 0 ? `${docs.length} 篇 · 共 ${totalChars.toLocaleString('zh-CN')} 字` : undefined}
      />

      {cats.length > 1 && (
        <div className="px-4 py-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
            <Link
              href="/docs"
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${!c ? 'bg-brand-500 text-white border-brand-500' : 'muted'}`}
              style={!c ? undefined : { borderColor: 'var(--border)' }}
            >
              全部
            </Link>
            {cats.filter((g) => g.category).map((g) => (
              <Link
                key={g.category}
                href={`/docs?c=${encodeURIComponent(g.category!)}`}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${c === g.category ? 'bg-brand-500 text-white border-brand-500' : 'muted'}`}
                style={c === g.category ? undefined : { borderColor: 'var(--border)' }}
              >
                {g.category} {g._count}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 pt-3 pb-4 space-y-2.5">
        {docs.length === 0 && (
          <p className="muted text-sm text-center py-20 leading-relaxed">
            还没有文稿。
            <br />
            发言稿、文章、信件这类成篇的文字会收在这里。
          </p>
        )}

        {docs.map((d) => (
          <Link
            key={d.id}
            href={`/docs/${d.id}`}
            className="block surface border rounded-2xl p-4 active:opacity-70 transition"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[15px] font-medium leading-snug">{d.title}</h2>
              {d.category && (
                <span
                  className="shrink-0 muted text-[11px] px-2 py-0.5 rounded-md"
                  style={{ background: 'var(--bg)' }}
                >
                  {d.category}
                </span>
              )}
            </div>

            {d.occasion && (
              <p className="muted text-xs mt-1.5 leading-relaxed">{d.occasion}</p>
            )}
            {d.summary && (
              <p className="text-[13px] mt-2 leading-relaxed" style={{ color: 'var(--text)' }}>
                {d.summary}
              </p>
            )}

            <p className="muted text-[11px] mt-2.5">
              {d.date && `${formatDate(d.date)} · `}
              {d.body.length.toLocaleString('zh-CN')} 字
              {d.attachments.length > 0 && ` · ${d.attachments.length} 个附件`}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
