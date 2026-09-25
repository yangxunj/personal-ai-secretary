import { search } from '@/lib/search';
import PageHeader from '@/components/PageHeader';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/** 只高亮第一处命中，避免正则和转义 */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q || !text) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded px-0.5 bg-brand-100 text-brand-800 dark:bg-brand-500/25 dark:text-brand-100">
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const keyword = (q ?? '').trim();
  const groups = keyword ? await search(keyword) : [];
  const total = groups.reduce((sum, g) => sum + g.hits.length, 0);

  return (
    <>
      <PageHeader
        title="搜索"
        subtitle={keyword ? `“${keyword}” 找到 ${total} 条` : '记录 · 任务 · 资料 · 财务 · 文稿 · 文件'}
        search={false}
      />

      <div className="px-4 py-3 space-y-4">
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={keyword}
            autoFocus
            placeholder="搜点什么，比如 门锁、图书馆、Claude…"
            className="flex-1 rounded-xl border px-4 py-2.5 bg-transparent outline-none focus:border-brand-500"
            style={{ borderColor: 'var(--border)' }}
          />
        </form>

        {!keyword && (
          <p className="muted text-sm leading-relaxed pt-8 text-center">
            一次搜遍全部六个板块。
            <br />
            账号、号码、商户名、文件名都能搜。
          </p>
        )}

        {keyword && total === 0 && (
          <p className="muted text-sm leading-relaxed pt-8 text-center">
            没找到「{keyword}」。
            <br />
            换个说法试试，或者直接问管家。
          </p>
        )}

        {groups.map((g) => (
          <section key={g.kind} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">
                {g.kind}
                <span className="muted font-normal ml-1.5 text-xs">{g.hits.length}</span>
              </h2>
              <Link href={g.href} className="muted text-xs">
                去{g.kind}页 →
              </Link>
            </div>

            <div className="space-y-2">
              {g.hits.map((h) => {
                const inner = (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[15px] font-medium break-all">
                        <Highlight text={h.title} q={keyword} />
                      </span>
                    </div>
                    {h.snippet && (
                      <p className="text-sm mt-1 leading-relaxed break-words line-clamp-2">
                        <Highlight text={h.snippet} q={keyword} />
                      </p>
                    )}
                    {h.meta && <p className="muted text-[11px] mt-1.5">{h.meta}</p>}
                  </>
                );

                const cls =
                  'block surface border rounded-2xl px-4 py-3 active:opacity-70 transition';

                return h.href.startsWith('/api/') ? (
                  <a
                    key={h.id}
                    href={h.href}
                    target="_blank"
                    className={cls}
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {inner}
                  </a>
                ) : (
                  <Link key={h.id} href={h.href} className={cls} style={{ borderColor: 'var(--border)' }}>
                    {inner}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
