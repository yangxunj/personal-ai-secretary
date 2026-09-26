import { db } from '@/lib/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { humanSize } from '@/lib/format';
import {
  accountLabel,
  BASE_CURRENCY,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  NON_SPEND_CATEGORIES,
  base,
  money,
  moneyRound,
  periodLabel,
  realIncome,
  realSpend,
  spendByCategory,
} from '@/lib/finance';
import { getLocale, getT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

/** 大额门槛：超过它的单笔单独列出来解释，剩下的看汇总就够了 */
const LARGE_CENTS = 100_000; // 1,000 元

/**
 * 金额右栏。**一律显示本位币等值**，外币行在下面补一行原币。
 *
 * 只显示折算后的本币，对不上自己记得的那个数字 —— 一笔记得是 USD 2,172
 * 的支出，页面上写 15,000 就成了另一笔账。只显示原币又更糟：2,172 会被
 * 当成两千块的小钱，而它其实是一万五。所以两个都要有。
 */
function Amount({
  tx,
}: {
  tx: { direction: string; amountCents: number; baseCents: number | null; currency: string };
}) {
  return (
    <>
      {tx.direction === 'debit' ? '-' : '+'}
      {money(base(tx), false)}
      {tx.currency !== BASE_CURRENCY && (
        <span className="muted block text-[10px] font-normal">
          {tx.currency} {money(tx.amountCents, false)}
        </span>
      )}
    </>
  );
}

export default async function StatementPage({
  params,
}: {
  params: Promise<{ period: string }>;
}) {
  const { period } = await params;
  const t = await getT();
  const locale = await getLocale();
  const st = await db.statement.findFirst({
    where: { period },
    include: {
      transactions: { orderBy: [{ date: 'asc' }, { id: 'asc' }] },
      attachments: true,
    },
  });
  if (!st) notFound();

  const txs = st.transactions;
  const spend = realSpend(txs);
  const income = realIncome(txs);
  const byCat = spendByCategory(txs);
  const pending = txs.filter((tx) => tx.category === 'uncategorized');

  // 大额往来剔除本人调拨：4 月光调拨就有 4 笔四万上下，不剔掉会把月租、校车费
  // 这些真正该看的项目挤出视野。调拨单独汇总成一行。
  // 「大额」的门槛按**本位币等值**判，不是按原币数字 —— 否则 USD 2,172 会被
  // 当成两千块的小钱放过去，而它其实是一万六。
  const large = txs
    .filter((tx) => base(tx) >= LARGE_CENTS && !NON_SPEND_CATEGORIES.includes(tx.category))
    .sort((a, b) => base(b) - base(a));
  const selfIn = txs
    .filter((tx) => tx.category === 'self_transfer' && tx.direction === 'credit')
    .reduce((a, tx) => a + base(tx), 0);
  const selfOut = txs
    .filter((tx) => tx.category === 'self_transfer' && tx.direction === 'debit')
    .reduce((a, tx) => a + base(tx), 0);

  const detail = txs.filter((tx) => tx.category !== 'balance');
  const netAsset =
    st.closingTotalCents != null && st.openingTotalCents != null
      ? st.closingTotalCents - st.openingTotalCents
      : null;

  const prev = await db.statement.findFirst({
    where: { period: { lt: period }, bank: st.bank, account: st.account },
    orderBy: { period: 'desc' },
    include: { transactions: { select: { direction: true, amountCents: true, baseCents: true, category: true } } },
  });
  const prevSpend = prev ? realSpend(prev.transactions) : null;

  return (
    <>
      <header
        className="sticky top-0 z-20 surface border-b pt-safe"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-1 px-2 h-14">
          <Link
            href="/finance"
            className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full active:opacity-60"
            aria-label={t('返回财务列表')}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <p className="text-sm font-medium">{periodLabel(st.period, locale)}</p>

          {st.attachments[0] && (
            <a
              href={`/api/files/${st.attachments[0].id}`}
              target="_blank"
              className="ml-auto mr-1 flex items-center gap-1.5 px-2.5 h-8 rounded-full border text-[12px] active:opacity-60"
              style={{ borderColor: 'var(--border)', color: 'var(--color-brand-500)' }}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
              </svg>
              {t('原件')}
            </a>
          )}
        </div>
      </header>

      <div className="px-4 pt-5 pb-6 space-y-6">
        {/* KPI */}
        <div>
          <p className="muted text-[11px]">
            {pending.length > 0 ? t('真实支出（不含待确认）') : t('真实支出')}
          </p>
          <p className="text-[32px] font-semibold tracking-tight leading-tight">{moneyRound(spend)}</p>
          {prevSpend !== null && (
            <p className="muted text-xs mt-0.5">
              {t('上月 {amount}', { amount: moneyRound(prevSpend) })}
              {spend !== prevSpend && (
                <span style={{ color: spend > prevSpend ? '#ef4444' : '#10b981' }}>
                  {' '}
                  {spend > prevSpend ? '↑' : '↓'} {money(Math.abs(spend - prevSpend), false)}
                </span>
              )}
            </p>
          )}

          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              // 不叫「真实收入」：这个账户的进账几乎全是从自己别的户口转来的，
              // 剔掉之后只剩利息和回赠。叫「收入」会让人以为这就是当月全部收入。
              { label: t('外部收入'), value: moneyRound(income) },
              {
                label: t('资产净变化'),
                value: netAsset == null ? '—' : `${netAsset >= 0 ? '+' : '-'}${moneyRound(Math.abs(netAsset))}`,
              },
              { label: t('期末余额'), value: moneyRound(st.closingBalanceCents) },
            ].map((k) => (
              <div key={k.label} className="surface border rounded-xl p-2.5" style={{ borderColor: 'var(--border)' }}>
                <p className="muted text-[10px]">{k.label}</p>
                <p className="text-[13px] font-medium mt-0.5">{k.value}</p>
              </div>
            ))}
          </div>

          {(selfIn > 0 || selfOut > 0) && (
            <p className="muted text-[11px] mt-2.5 leading-relaxed">
              {t('另有本人账户调拨：转入 {in}、转出 {out}', { in: money(selfIn), out: money(selfOut) })}
              {selfIn !== selfOut &&
                t('（净 {net}）', { net: `${selfIn > selfOut ? '+' : '-'}${money(Math.abs(selfIn - selfOut), false)}` })}
              {t('。这部分不算支出也不算收入 —— 是自己在不同户口之间搬钱。')}
            </p>
          )}
        </div>

        {/* 分类汇总 */}
        <section>
          <h2 className="text-[13px] font-medium mb-2.5">{t('钱花在哪')}</h2>
          <div className="space-y-2.5">
            {byCat.map(([cat, cents]) => (
              <div key={cat}>
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="flex items-center gap-1.5">
                    <i className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLORS[cat] ?? '#94a3b8' }} />
                    {t(CATEGORY_LABELS[cat] ?? cat)}
                  </span>
                  <span className="tabular-nums">{money(cents)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(cents / spend) * 100}%`, background: CATEGORY_COLORS[cat] ?? '#94a3b8' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 待确认 —— 放在大额之前，因为这是唯一需要主人动作的部分 */}
        {pending.length > 0 && (
          <section>
            <h2 className="text-[13px] font-medium mb-2 flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLORS.uncategorized }} />
              {t('待确认 {n} 笔', { n: pending.length })}
            </h2>
            <div className="surface border rounded-2xl divide-y" style={{ borderColor: 'var(--border)' }}>
              {pending.map((tx) => (
                <div key={tx.id} className="p-3 flex items-baseline justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="min-w-0">
                    <p className="text-[13px] break-all">{tx.counterparty ?? '—'}</p>
                    <p className="muted text-[11px] mt-0.5">{tx.date.toISOString().slice(0, 10)}</p>
                  </div>
                  <span className="text-[13px] tabular-nums shrink-0 text-right" style={{ color: tx.direction === 'debit' ? 'var(--text)' : '#10b981' }}>
                    <Amount tx={tx} />
                  </span>
                </div>
              ))}
            </div>
            <p className="muted text-[11px] mt-2 leading-relaxed">
              {t('原文里没有对手方信息，我不猜。告诉我是什么，我补进规则，以后自动归类。')}
            </p>
          </section>
        )}

        {/* 大额 */}
        {large.length > 0 && (
          <section>
            <h2 className="text-[13px] font-medium mb-2">{t('大额往来（≥ {amount}）', { amount: moneyRound(LARGE_CENTS) })}</h2>
            <div className="surface border rounded-2xl divide-y" style={{ borderColor: 'var(--border)' }}>
              {large.map((tx) => (
                <div key={tx.id} className="p-3 flex items-baseline justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="min-w-0">
                    <p className="text-[13px] break-all">{tx.label ?? tx.counterparty ?? '—'}</p>
                    <p className="muted text-[11px] mt-0.5">
                      {tx.date.toISOString().slice(0, 10)}
                      {tx.counterparty && tx.label !== tx.counterparty && ` · ${tx.counterparty}`}
                    </p>
                  </div>
                  <span className="text-[13px] tabular-nums shrink-0 text-right" style={{ color: tx.direction === 'debit' ? 'var(--text)' : '#10b981' }}>
                    <Amount tx={tx} />
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 明细 */}
        <section>
          <details className="group">
            <summary className="text-[13px] font-medium cursor-pointer list-none flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="h-4 w-4 transition group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
              {t('全部明细（{n} 笔）', { n: detail.length })}
            </summary>
            <div className="mt-2.5 surface border rounded-2xl divide-y" style={{ borderColor: 'var(--border)' }}>
              {detail.map((tx) => (
                <div key={tx.id} className="px-3 py-2 flex items-baseline justify-between gap-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="min-w-0">
                    <p className="text-[13px] break-all">{tx.label ?? tx.counterparty ?? '—'}</p>
                    <p className="muted text-[10px] mt-0.5">
                      {tx.date.toISOString().slice(0, 10)} · {t(CATEGORY_LABELS[tx.category] ?? tx.category)}
                      {accountLabel(tx.account) && ` · ${accountLabel(tx.account)}`}
                    </p>
                  </div>
                  <span className="text-[12px] tabular-nums shrink-0 text-right" style={{ color: tx.direction === 'debit' ? 'var(--muted)' : '#10b981' }}>
                    <Amount tx={tx} />
                  </span>
                </div>
              ))}
            </div>
          </details>
        </section>

        {st.attachments.length > 0 && (
          <section>
            <h2 className="text-[13px] font-medium mb-2">{t('原始月结单')}</h2>
            <div className="surface border rounded-2xl divide-y" style={{ borderColor: 'var(--border)' }}>
              {st.attachments.map((a) => (
                <a
                  key={a.id}
                  href={`/api/files/${a.id}`}
                  target="_blank"
                  className="flex items-center gap-3 p-3 active:opacity-70 transition"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center" style={{ background: 'var(--bg)' }}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4 muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] break-all">{a.filename}</p>
                    <p className="muted text-[11px]">{humanSize(a.size)} · {t('银行发出的原件')}</p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        <p className="muted text-[11px] leading-relaxed">
          {t('分类是按生活口径归的，不是银行官方分类 —— 归错了跟我说一声，我改。')}
          {st.note && <> {t('本月提醒：{note}。', { note: st.note })}</>}
        </p>
      </div>
    </>
  );
}
