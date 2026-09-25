import { db } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import Notes from '@/components/Notes';
import Link from 'next/link';
import { catRank, STATUS_STYLE } from './shared';

export const dynamic = 'force-dynamic';

/**
 * 健康页 = 家庭成员 + 他们的体检报告。
 *
 * 排版的取舍：**先给结论，再给数字。** 体检报告一打开是几十项指标，全铺出来
 * 等于把 PDF 抄了一遍 —— 主人真正要看的是「哪几项不正常」。所以卡片上只列
 * 异常项，正常的收在「全部 N 项」后面（点进详情页看）。
 */

function age(birth: Date | null) {
  if (!birth) return null;
  return Math.floor((Date.now() - birth.getTime()) / 31557600000);
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;

  const members = await db.member.findMany({
    orderBy: { sort: 'asc' },
    include: { _count: { select: { reports: true } } },
  });

  const reports = await db.healthReport.findMany({
    where: m ? { memberId: m } : {},
    orderBy: { checkDate: 'desc' },
    include: {
      member: { select: { id: true, name: true, relation: true } },
      metrics: { orderBy: [{ category: 'asc' }, { name: 'asc' }] },
      attachments: true,
    },
  });

  const current = m ? members.find((x) => x.id === m) : null;

  return (
    <>
      <PageHeader
        title="健康"
        subtitle={
          current
            ? `${current.name} · ${reports.length} 份报告`
            : `${members.length} 位家人 · ${reports.length} 份报告`
        }
      />

      <div className="px-4 py-3 space-y-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
          <Link
            href="/health"
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${!m ? 'bg-brand-500 text-white border-brand-500' : 'muted'}`}
            style={!m ? undefined : { borderColor: 'var(--border)' }}
          >
            全部
          </Link>
          {members.map((p) => (
            <Link
              key={p.id}
              href={`/health?m=${p.id}`}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${m === p.id ? 'bg-brand-500 text-white border-brand-500' : 'muted'}`}
              style={m === p.id ? undefined : { borderColor: 'var(--border)' }}
            >
              {p.name} {p._count.reports}
            </Link>
          ))}
        </div>

        {/* 选中某个人时，先把这个人的基本情况和慢性病亮出来 —— 看报告之前
            得知道他有糖尿病，不然那个血糖值意味着什么无从判断 */}
        {current && (
          <div className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-baseline gap-2">
              <h2 className="font-medium">{current.name}</h2>
              <span className="muted text-[11px]">
                {current.relation}
                {age(current.birthDate) != null && ` · ${age(current.birthDate)} 岁`}
                {current.gender && ` · ${current.gender === 'male' ? '男' : '女'}`}
                {current.bloodType && ` · ${current.bloodType} 型`}
              </span>
            </div>
            {current.chronicDiseases && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {current.chronicDiseases.split(/[,，]/).filter(Boolean).map((d) => (
                  <span
                    key={d}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100"
                  >
                    {d.trim()}
                  </span>
                ))}
              </div>
            )}
            {current.allergies && (
              <p className="text-sm mt-2">
                <span className="muted">过敏：</span>
                {current.allergies}
              </p>
            )}
            {current.notes && <Notes>{current.notes}</Notes>}
          </div>
        )}
      </div>

      <div className="px-4 pb-4 space-y-2">
        {reports.length === 0 && (
          <p className="muted text-sm text-center py-20 leading-relaxed">
            {members.length === 0 ? '还没有家庭成员。' : '还没有体检报告。'}
            <br />
            把报告发给管家，他读完会整理进来。
          </p>
        )}

        {reports.map((r) => {
          const bad = r.metrics
            .filter((x) => x.status !== 'normal')
            .sort((a, b) => catRank(a.category) - catRank(b.category) || a.name.localeCompare(b.name));
          const shots = r.attachments.filter((a) => a.mimeType.startsWith('image/'));
          const docs = r.attachments.filter((a) => !a.mimeType.startsWith('image/'));

          return (
            <div key={r.id} className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium leading-snug">{r.title}</h3>
                  <p className="muted text-[11px] mt-0.5">
                    {r.checkDate.toISOString().slice(0, 10)}
                    {!m && ` · ${r.member.name}`}
                    {r.institution && ` · ${r.institution}`}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[11px] px-2 py-1 rounded-lg ${
                    bad.length
                      ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
                  }`}
                >
                  {bad.length ? `${bad.length} 项异常` : '全部正常'}
                </span>
              </div>

              {/* 只列不正常的。正常的几十项在这里铺开等于把 PDF 抄一遍 */}
              {bad.length > 0 && (
                <dl className="mt-3 space-y-1.5">
                  {bad.map((x, i) => {
                    const st = STATUS_STYLE[x.status] ?? STATUS_STYLE.abnormal;
                    const newCat = i === 0 || bad[i - 1].category !== x.category;
                    return (
                      <div key={x.id} className={`flex items-start gap-2.5 text-sm ${newCat && i > 0 ? 'pt-2' : ''}`}>
                        <dt className="shrink-0 w-28 text-[13px] leading-5 muted">
                          {newCat && (
                            <span className="block text-[10px] opacity-70 leading-4">{x.category}</span>
                          )}
                          {x.name}
                        </dt>
                        <dd className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="font-medium tabular-nums">
                            {x.value}
                            {x.unit && <span className="muted font-normal ml-0.5">{x.unit}</span>}
                          </span>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                          {x.referenceRange && (
                            <span className="muted text-[11px]">参考 {x.referenceRange}</span>
                          )}
                          {x.note && <span className="muted text-[11px] w-full">{x.note}</span>}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}

              {/* 卡片只列异常项，正常那几十项要靠这个入口 —— 没有它，主人在
                  手机上就查不到「我上次血糖多少」 */}
              {r.metrics.length > 0 && (
                <Link
                  href={`/health/${r.id}`}
                  className="mt-2.5 flex items-center gap-1 text-[11px] active:opacity-60"
                  style={{ color: 'var(--color-brand-500)' }}
                >
                  看全部 {r.metrics.length} 项
                  {bad.length > 0 && `（其余 ${r.metrics.length - bad.length} 项正常）`}
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </Link>
              )}

              {r.summary && <Notes>{r.summary}</Notes>}

              {/* 归档说明：原件多少页、哪些页没录进来、为什么。跟 summary 分开，
                  因为它讲的是「这条记录本身可不可信」，不是体检结果 */}
              {r.notes && (
                <details className="mt-3 rounded-xl px-3 py-2" style={{ background: 'var(--bg)' }}>
                  <summary className="muted text-[11px] cursor-pointer select-none list-none">
                    归档说明 · 原件里哪些内容没录进来 ▾
                  </summary>
                  <div className="text-[13px]">
                    <Notes>{r.notes}</Notes>
                  </div>
                </details>
              )}

              {shots.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
                  {shots.map((a) => (
                    <a
                      key={a.id}
                      href={`/api/files/${a.id}`}
                      target="_blank"
                      className="shrink-0 w-24 rounded-xl overflow-hidden border active:opacity-70"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/files/${a.id}?w=240`}
                        alt={a.note || a.filename}
                        loading="lazy"
                        width={96}
                        height={96}
                        className="w-24 h-24 object-cover block"
                        style={{ background: 'var(--bg)' }}
                      />
                    </a>
                  ))}
                </div>
              )}

              {docs.map((a) => (
                <a
                  key={a.id}
                  href={`/api/files/${a.id}`}
                  target="_blank"
                  className="mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2 active:opacity-70"
                  style={{ background: 'var(--bg)' }}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
                  </svg>
                  <span className="text-xs break-all">{a.note || a.filename}</span>
                </a>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
