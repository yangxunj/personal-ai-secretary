import { db } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import Link from 'next/link';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  money,
  moneyRound,
  periodLabel,
  realSpend,
  pending as pendingOf,
  spendByCategory,
} from '@/lib/finance';

export const dynamic = 'force-dynamic';

export default async function FinancePage() {
  const statements = await db.statement.findMany({
    orderBy: { period: 'desc' },
    include: {
      transactions: { select: { direction: true, amountCents: true, baseCents: true, category: true } },
      attachments: { select: { id: true, filename: true, mimeType: true } },
    },
  });

  const months = statements.map((st) => ({
    ...st,
    spend: realSpend(st.transactions),
    byCat: spendByCategory(st.transactions),
    pending: pendingOf(st.transactions),
  }));

  return (
    <>
      <PageHeader
        title="财务"
        subtitle={months.length > 0 ? `${months.length} 个月` : undefined}
      />

      <div className="px-4 pt-4 pb-4 space-y-3">
        {months.length === 0 && (
          <p className="muted text-sm text-center py-20 leading-relaxed">
            还没有账单。
            <br />
            把银行月结单 PDF 发给我，我解析后收进来。
          </p>
        )}

        {months.map((m, i) => {
          const prev = months[i + 1];
          const delta = prev ? m.spend - prev.spend : null;

          return (
            <div
              key={m.id}
              className="surface border rounded-2xl overflow-hidden"
              style={{ borderColor: 'var(--border)' }}
            >
            <Link href={`/finance/${m.period}`} className="block p-4 active:opacity-70 transition">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[15px] font-medium">{periodLabel(m.period)}</h2>
                {m.pending.count > 0 && (
                  <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-md bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400">
                    {m.pending.count} 笔待确认
                  </span>
                )}
              </div>

              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight">{moneyRound(m.spend)}</span>
                <span className="muted text-[11px]">真实支出</span>
                {delta !== null && (
                  <span
                    className="text-[11px] ml-auto"
                    style={{ color: delta > 0 ? '#ef4444' : '#10b981' }}
                  >
                    {delta > 0 ? '↑' : '↓'} {money(Math.abs(delta), false)}
                  </span>
                )}
              </div>

              {/* 一条占比横杠，比饼图更省地方，手机上也看得清 */}
              <div className="mt-3 flex h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg)' }}>
                {m.byCat.map(([cat, cents]) => (
                  <div
                    key={cat}
                    style={{
                      width: `${(cents / m.spend) * 100}%`,
                      background: CATEGORY_COLORS[cat] ?? '#94a3b8',
                    }}
                  />
                ))}
              </div>

              <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
                {m.byCat.slice(0, 4).map(([cat, cents]) => (
                  <span key={cat} className="muted text-[11px] flex items-center gap-1">
                    <i
                      className="h-2 w-2 rounded-full inline-block"
                      style={{ background: CATEGORY_COLORS[cat] ?? '#94a3b8' }}
                    />
                    {CATEGORY_LABELS[cat] ?? cat} {Math.round((cents / m.spend) * 100)}%
                  </span>
                ))}
              </div>

              <p className="muted text-[11px] mt-2.5">
                {m.transactions.length} 笔 · 期末余额 {money(m.closingBalanceCents)}
                {m.pending.count > 0 && (
                  <>
                    <br />
                    另有 {m.pending.count} 笔待确认（支出 {money(m.pending.debitCents)}
                    {m.pending.creditCents > 0 && `、收入 ${money(m.pending.creditCents)}`}
                    ）未计入上面的支出
                  </>
                )}
              </p>
            </Link>

            {m.attachments.map((a) => (
              <a
                key={a.id}
                href={`/api/files/${a.id}`}
                target="_blank"
                className="flex items-center gap-2 px-4 py-2.5 border-t text-[12px] active:opacity-60 transition"
                style={{ borderColor: 'var(--border)', color: 'var(--color-brand-500)' }}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
                </svg>
                查看原始月结单
              </a>
            ))}
            </div>
          );
        })}

        {months.length > 0 && (
          <p className="muted text-[11px] leading-relaxed px-1 pt-2">
            「真实支出」已剔除本人账户之间的调拨和月初月末结余行 —— 自己把钱从一个户口搬到另一个，
            不该算进花掉的钱。
          </p>
        )}
      </div>
    </>
  );
}
