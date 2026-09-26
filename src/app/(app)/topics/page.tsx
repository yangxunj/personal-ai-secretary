import { db } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { TOPIC_STATUS, parseQuestions } from '@/lib/topic';
import { getLocale, getT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

const ORDER = ['active', 'settled', 'parked'];

export default async function TopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  const { s } = await searchParams;
  const t = await getT();
  const locale = await getLocale();
  const status = s && TOPIC_STATUS[s] ? s : 'active';

  const all = await db.topic.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { tasks: true, attachments: true, messages: true } } },
  });

  // 跟任务页同一条规矩：0 的胶囊压暗但不隐身，位置固定才记得住
  const counts = new Map(ORDER.map((k) => [k, all.filter((x) => x.status === k).length]));
  const topics = all.filter((x) => x.status === status);

  return (
    <>
      <PageHeader
        title={t('专题')}
        subtitle={t('{status} {n} 个', { status: t(TOPIC_STATUS[status]), n: topics.length })}
      />

      {all.length > 0 && (
        <div className="px-4 pt-3 flex gap-1.5 overflow-x-auto pb-1">
          {ORDER.map((k) => {
            const active = status === k;
            const empty = (counts.get(k) ?? 0) === 0;
            return (
              <Link
                key={k}
                href={k === 'active' ? '/topics' : `/topics?s=${k}`}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${empty && !active ? 'opacity-40' : ''} ${
                  active ? 'bg-brand-500 text-white border-brand-500' : 'muted'
                }`}
                style={active ? undefined : { borderColor: 'var(--border)' }}
              >
                {t(TOPIC_STATUS[k])} {counts.get(k)}
              </Link>
            );
          })}
        </div>
      )}

      <div className="px-4 py-4 space-y-3">
        {all.length === 0 && (
          <p className="muted text-sm text-center py-20 leading-relaxed">
            {t('还没有专题。')}
            <br />
            {t('有什么想弄明白的事，在「沟通」里跟我说一声。')}
          </p>
        )}

        {all.length > 0 && topics.length === 0 && (
          <p className="muted text-sm text-center py-20">{t('没有「{status}」的专题。', { status: t(TOPIC_STATUS[status]) })}</p>
        )}

        {topics.map((topic) => {
          const qs = parseQuestions(topic.questions);
          const open = qs.filter((q) => !q.done).length;
          return (
            <Link
              key={topic.id}
              href={`/topics/${topic.id}`}
              className="block surface border rounded-2xl p-4 active:opacity-70"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium leading-snug">{topic.title}</h3>
                {/* 卡片上最该显示的不是日期，是「还没搞清楚几件事」——
                    主人要的是「不再有任何疑问」，这个数归零就是完成 */}
                {qs.length > 0 && (
                  <span
                    className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full font-medium ${
                      open === 0
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400'
                    }`}
                  >
                    {open === 0 ? t('都清楚了') : t('还有 {n} 件没弄清', { n: open })}
                  </span>
                )}
              </div>

              {topic.summary && <p className="muted text-sm mt-1.5 leading-relaxed">{topic.summary}</p>}

              <div className="flex items-center gap-2 mt-3 muted text-[11px] flex-wrap">
                <span className="px-2 py-0.5 rounded-md" style={{ background: 'var(--bg)' }}>
                  {t(topic.category)}
                </span>
                {topic.page && <span className="text-brand-600 dark:text-brand-400">{t('有呈现页')}</span>}
                {topic._count.tasks > 0 && <span>· {t('任务 {n}', { n: topic._count.tasks })}</span>}
                {topic._count.attachments > 0 && <span>· {t('附件 {n}', { n: topic._count.attachments })}</span>}
                <span>· {formatDate(topic.updatedAt, locale)}</span>
              </div>
            </Link>
          );
        })}

        {/* 页面只上了宽屏侧栏，手机上从这里进 */}
        <Link
          href="/pages"
          className="lg:hidden flex items-center justify-between gap-3 mt-6 px-4 py-3.5 rounded-2xl border active:opacity-70"
          style={{ borderColor: 'var(--border)' }}
        >
          <span className="muted text-sm">{t('页面 —— 在对话里让 AI 做的图表、报告、小游戏')}</span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 muted shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>

        {/* 文稿把底栏那一格让给了专题，入口收在这里 */}
        <Link
          href="/docs"
          className="flex items-center justify-between gap-3 mt-3 lg:mt-6 px-4 py-3.5 rounded-2xl border active:opacity-70"
          style={{ borderColor: 'var(--border)' }}
        >
          <span className="muted text-sm">{t('文稿 —— 主人写的发言稿、文章、信件')}</span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 muted shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
      </div>
    </>
  );
}
