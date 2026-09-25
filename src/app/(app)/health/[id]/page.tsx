import { db } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import MessageBody from '@/components/MessageBody';
import ImageGallery from '@/components/ImageGallery';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CATEGORY_ORDER, catRank, STATUS_STYLE } from '../shared';

export const dynamic = 'force-dynamic';

/**
 * 一份体检报告的全部内容。
 *
 * 列表页只显示异常项（几十项全铺开等于把 PDF 抄一遍），**代价是正常项在手机上
 * 完全看不到** —— 主人想查「我上次血糖多少」做不到，只能让我去命令行跑
 * `health:show`。这一页就是补那个缺口：默认列全部，可以切到只看异常。
 *
 * 按分类分组，分类顺序用跟列表页同一张表（`CATEGORY_ORDER`），
 * 这样「肾功能在最前」这件事两边一致。
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ only?: string }>;
}) {
  const { id } = await params;
  const { only } = await searchParams;
  const onlyBad = only === 'bad';

  const r = await db.healthReport.findUnique({
    where: { id },
    include: {
      member: { select: { id: true, name: true, relation: true } },
      metrics: true,
      attachments: true,
    },
  });
  if (!r) notFound();

  const shown = onlyBad ? r.metrics.filter((m) => m.status !== 'normal') : r.metrics;
  const badCount = r.metrics.filter((m) => m.status !== 'normal').length;

  // 分组：分类内按「异常的排前面」，同状态按名字。异常项埋在三十行正常值中间
  // 就等于没显示。
  const groups = [...new Set(shown.map((m) => m.category))]
    .sort((a, b) => catRank(a) - catRank(b))
    .map((cat) => ({
      cat,
      items: shown
        .filter((m) => m.category === cat)
        .sort(
          (a, b) =>
            Number(a.status === 'normal') - Number(b.status === 'normal') ||
            a.name.localeCompare(b.name)
        ),
    }));

  const shots = r.attachments.filter((a) => a.mimeType.startsWith('image/'));
  const docs = r.attachments.filter((a) => !a.mimeType.startsWith('image/'));

  return (
    <>
      <PageHeader
        title={r.title}
        subtitle={`${r.member.name} · ${r.checkDate.toISOString().slice(0, 10)}${r.institution ? ' · ' + r.institution : ''}`}
        back={`/health?m=${r.member.id}`}
      />

      <div className="px-4 py-3 space-y-3">
        <div className="flex gap-1.5">
          <Link
            href={`/health/${r.id}`}
            className={`text-xs px-3 py-1.5 rounded-full border ${!onlyBad ? 'bg-brand-500 text-white border-brand-500' : 'muted'}`}
            style={!onlyBad ? undefined : { borderColor: 'var(--border)' }}
          >
            全部 {r.metrics.length}
          </Link>
          <Link
            href={`/health/${r.id}?only=bad`}
            className={`text-xs px-3 py-1.5 rounded-full border ${onlyBad ? 'bg-brand-500 text-white border-brand-500' : 'muted'}`}
            style={onlyBad ? undefined : { borderColor: 'var(--border)' }}
          >
            只看异常 {badCount}
          </Link>
        </div>

        {r.summary && (
          <div className="surface border rounded-2xl p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
            <MessageBody>{r.summary}</MessageBody>
          </div>
        )}

        {groups.map(({ cat, items }) => (
          <div key={cat} className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-[13px] font-medium mb-2.5">{cat}</h2>
            <dl className="space-y-1.5">
              {items.map((x) => {
                const st = x.status === 'normal' ? null : (STATUS_STYLE[x.status] ?? STATUS_STYLE.abnormal);
                return (
                  <div key={x.id} className="flex items-start gap-2.5 text-sm">
                    <dt className={`shrink-0 w-28 text-[13px] leading-5 ${st ? '' : 'muted'}`}>{x.name}</dt>
                    <dd className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className={st ? 'font-medium tabular-nums' : 'tabular-nums'}>
                        {x.value}
                        {x.unit && <span className="muted font-normal ml-0.5">{x.unit}</span>}
                      </span>
                      {st && <span className={`text-[11px] px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>}
                      {x.referenceRange && (
                        <span className="muted text-[11px]">参考 {x.referenceRange}</span>
                      )}
                      {x.note && <span className="muted text-[11px] w-full">{x.note}</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}

        {shots.length > 0 && (
          <div className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-[13px] font-medium mb-2.5">原件</h2>
            <ImageGallery shots={shots.map((a) => ({ id: a.id, label: a.note || a.filename }))} />
          </div>
        )}

        {docs.map((a) => (
          <a
            key={a.id}
            href={`/api/files/${a.id}`}
            target="_blank"
            className="surface border rounded-2xl px-4 py-3 flex items-center gap-2.5 active:opacity-70"
            style={{ borderColor: 'var(--border)' }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
            </svg>
            <span className="text-sm break-all">{a.note || a.filename}</span>
          </a>
        ))}

        {r.notes && (
          <details className="surface border rounded-2xl px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <summary className="muted text-[11px] cursor-pointer select-none list-none">
              归档说明 · 原件里哪些内容没录进来 ▾
            </summary>
            <div className="text-[13px]">
              <MessageBody>{r.notes}</MessageBody>
            </div>
          </details>
        )}
      </div>
    </>
  );
}
