import { db } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import { humanSize } from '@/lib/format';
import { formatTime } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;

  const files = await db.attachment.findMany({
    where: c ? { category: c } : {},
    orderBy: { createdAt: 'desc' },
    include: {
      task: { select: { title: true } },
      vaultItem: { select: { title: true } },
    },
  });

  const cats = await db.attachment.groupBy({ by: ['category'], _count: true });
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  const isImage = (m: string) => m.startsWith('image/');

  return (
    <>
      <PageHeader title="文件" subtitle={`${files.length} 个文件 · ${humanSize(totalSize)}`} />

      <div className="px-4 py-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
          <Link
            href="/files"
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${!c ? 'bg-brand-500 text-white border-brand-500' : 'muted'}`}
            style={!c ? undefined : { borderColor: 'var(--border)' }}
          >
            全部
          </Link>
          {cats.filter((g) => g.category).map((g) => (
            <Link
              key={g.category}
              href={`/files?c=${encodeURIComponent(g.category!)}`}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${c === g.category ? 'bg-brand-500 text-white border-brand-500' : 'muted'}`}
              style={c === g.category ? undefined : { borderColor: 'var(--border)' }}
            >
              {g.category} {g._count}
            </Link>
          ))}
        </div>
      </div>

      <div className="px-4 pb-4 space-y-2">
        {files.length === 0 && (
          <p className="muted text-sm text-center py-20 leading-relaxed">
            还没有文件。
            <br />
            在「沟通」里点回形针，就能把账单、报告发过来。
          </p>
        )}

        {files.map((f) => (
          <a
            key={f.id}
            href={`/api/files/${f.id}`}
            target="_blank"
            className="flex items-start gap-3 surface border rounded-2xl p-3 active:opacity-70 transition"
            style={{ borderColor: 'var(--border)' }}
          >
            <div
              className="h-11 w-11 shrink-0 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--bg)' }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                {isImage(f.mimeType) ? (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </>
                ) : (
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
                )}
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium break-all">{f.filename}</p>
              <p className="muted text-[11px] mt-0.5">
                {humanSize(f.size)} · {formatTime(f.createdAt)}
                {f.uploadedBy === 'secretary' && ' · 管家生成'}
              </p>
              {(f.task || f.vaultItem || f.note) && (
                <p className="muted text-[11px] break-all mt-0.5">
                  {f.task ? `任务：${f.task.title}` : f.vaultItem ? `资料：${f.vaultItem.title}` : f.note}
                </p>
              )}
            </div>
            {f.category && (
              <span className="shrink-0 muted text-[11px] px-2 py-0.5 rounded-md" style={{ background: 'var(--bg)' }}>
                {f.category}
              </span>
            )}
          </a>
        ))}
      </div>
    </>
  );
}
