import Link from 'next/link';
import { db } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import { formatTime } from '@/lib/format';
import { PAGE_KINDS, type PageKind } from '@/lib/pages';
import { SAMPLE_CATEGORIES } from '@/lib/sample-pages';

export const dynamic = 'force-dynamic';

/** 空页面墙上给几句能直接点的话 —— 空白对不会写提示词的人是一堵墙（livepage 的教训） */
const EXAMPLES = [
  '做个页面，看看今年每个月钱都花在哪了',
  '把全家的保单做成一张缴费日历',
  '做个贪吃蛇小游戏，手机上能玩',
  '做个页面，列出家里每个人最近一次体检的异常项',
];

type Card = {
  id: string;
  title: string;
  summary: string | null;
  kind: string;
  sample: string | null;
  updatedAt: Date;
  _count: { versions: number };
};

export default async function PagesPage() {
  const all = await db.page.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, title: true, summary: true, kind: true, sample: true, updatedAt: true, createdAt: true,
      _count: { select: { versions: true } },
    },
  });
  // 示例单列一块、按类别排，不跟用户自己的混在一起按时间排 ——
  // 不然用户做了几个之后，示例被挤到最后，又或者反过来示例压在他的东西上面
  const pages = all.filter((p) => !p.sample);
  const samples = all
    .filter((p) => p.sample)
    .sort(
      (a, b) =>
        SAMPLE_CATEGORIES.indexOf(a.sample!) - SAMPLE_CATEGORIES.indexOf(b.sample!) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );

  return (
    <>
      <PageHeader title="页面" subtitle={pages.length ? `${pages.length} 个 · 在对话里让 AI 做的` : '在对话里让 AI 做的'} />

      <div className="px-4 py-4">
        {pages.length === 0 ? (
          <div className={samples.length ? 'py-6 text-center' : 'py-14 text-center'}>
            <p className="muted text-sm leading-relaxed">
              {samples.length ? '你还没让 AI 做过页面。' : '还没有页面。'}
              <br />
              在对话里说一句，AI 会把它做成一个网页放在这里。比如：
            </p>
            <div className="mt-5 flex flex-col items-center gap-2">
              {EXAMPLES.map((e) => (
                <Link
                  key={e}
                  href={`/chat?draft=${encodeURIComponent(e)}`}
                  className="text-sm px-4 py-2 rounded-full border active:opacity-70 hover:border-brand-500 transition"
                  style={{ borderColor: 'var(--border)' }}
                >
                  「{e}」
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <Grid pages={pages} />
        )}

        {samples.length > 0 && (
          <section className="mt-8">
            <h2 className="font-medium">示例</h2>
            <p className="muted text-[12px] mt-1 mb-3 leading-relaxed">
              下面这些都是在对话里说一句话做出来的，点开能直接玩、直接用，详情页上有当初那句话。
              照着说、或者让 AI 在它基础上改都行。用不着的可以删掉。
            </p>
            <Grid pages={samples} />
          </section>
        )}
      </div>
    </>
  );
}

function Grid({ pages }: { pages: Card[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {pages.map((p) => (
        <Link
          key={p.id}
          href={`/pages/${p.id}`}
          className="block surface border rounded-2xl p-4 active:opacity-70 hover:border-brand-500/60 transition"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-medium leading-snug">{p.title}</h3>
            <span
              className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full font-medium ${
                p.sample
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                  : p.kind === 'app'
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                    : 'bg-brand-500/10 text-brand-600 dark:text-brand-300'
              }`}
            >
              {p.sample ? `示例 · ${p.sample}` : (PAGE_KINDS[p.kind as PageKind] ?? p.kind)}
            </span>
          </div>
          {p.summary && <p className="muted text-sm mt-1.5 leading-relaxed line-clamp-2">{p.summary}</p>}
          {!p.sample && (
            <p className="muted text-[11px] mt-3">
              {formatTime(p.updatedAt)} 更新
              {p._count.versions > 0 && ` · 改过 ${p._count.versions} 次`}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}
