/**
 * 账单口径。
 *
 * 跟主平台的差别：主平台的分类是一套认某家银行月结单版式的规则跑出来的；
 * 这一版**没有解析器**，分类由 AI 读账单时直接给出（跟体检报告一个路子）。
 * 所以这里只负责显示和汇总。
 *
 * 分类值本身是通用的生活口径，不是哪家银行的官方分类 —— 换银行、换国家
 * 都不用改。
 */

/** 货币符号。这一版是人民币，主平台是港币，靠环境变量区分 */
export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY_SYMBOL ?? '¥';

/** 本位币代码。交易的 currency 不等于它才算外币，才需要显示原币那一行 */
export const BASE_CURRENCY = process.env.NEXT_PUBLIC_BASE_CURRENCY ?? 'CNY';

export const CATEGORY_LABELS: Record<string, string> = {
  fixed_cost: '固定成本',
  daily_life: '日常生活',
  tools_subscription: '工具 / 订阅',
  big_purchase: '大额采购',
  self_transfer: '本人账户调拨',
  pass_through: '资金往来',
  salary: '工资',
  other_income: '其他收入',
  uncategorized: '待确认',
  balance: '余额项',
};

/** 展示顺序：花得最多的、最该看的排前面 */
export const CATEGORY_ORDER = [
  'fixed_cost',
  'daily_life',
  'tools_subscription',
  'big_purchase',
  'uncategorized',
  'salary',
  'other_income',
  'self_transfer',
  'pass_through',
  'balance',
];

export const CATEGORY_COLORS: Record<string, string> = {
  fixed_cost: '#4f6ef7',
  daily_life: '#f59e0b',
  tools_subscription: '#8b5cf6',
  big_purchase: '#ec4899',
  uncategorized: '#ef4444',
  other_income: '#10b981',
  self_transfer: '#94a3b8',
  pass_through: '#64748b',
  salary: '#10b981',
  balance: '#cbd5e1',
};

/**
 * 不算作「真实支出」的分类。
 *
 * `self_transfer` 是自己账户之间搬钱：当天转出又转回，算进支出会让当月
 * 凭空多出一大笔。`balance` 是月初月末结余行，本来就不是交易。
 *
 * `pass_through` 是**钱回来了但不是赚的**：垫付报销、借出款收回。算进收入
 * 会让人以为那个月多挣了钱，其实只是本金回笼。
 *
 * 这三项不剔掉，「钱花到哪去了」就没法看。
 */
export const NON_SPEND_CATEGORIES = ['self_transfer', 'balance', 'pass_through'];

/**
 * 统计「真实支出」时还要额外排除**待确认**。
 *
 * 一对同日一进一出的大额往来，多半是代收代付而不是花掉的钱。把它算进支出，
 * 当月数字可能虚高好几倍 —— 一眼看去很吓人，而结论是错的。
 *
 * 但**不能把待确认藏起来**：页面单独列一行金额，归类之后自然并入。
 * 注意这跟 NON_SPEND_CATEGORIES 是两回事，「大额往来」仍然要显示待确认项 ——
 * 没定性的大钱恰恰最该被看见。
 */
export const SPEND_EXCLUDED = [...NON_SPEND_CATEGORIES, 'uncategorized'];

/**
 * 账户显示名。
 *
 * 主平台写死了某家银行综合月结单的三本账。这一版不知道用哪家银行、
 * 有几个户口，所以**由 AI 导入时自己填中文名**，这里只做兜底：
 * `main` 是默认主账户，页面上不标它（标了满屏都是）。
 */
export const MAIN_ACCOUNT = 'main';
export function accountLabel(account: string): string {
  return account === MAIN_ACCOUNT ? '' : account;
}

export type Tx = {
  direction: string;
  amountCents: number;
  /** 本位币等值。外币交易才有意义 —— 见下面 base() */
  baseCents?: number | null;
  category: string;
};

/**
 * 加总一律走这个，不要直接加 amountCents。
 *
 * 同一张表里可能混着本币和外币。直接加 amountCents 会把 USD 2,172 当成
 * ¥2,172 算进去 —— 少算七倍，而且是**静默**少算，报表上看不出任何异常。
 *
 * baseCents 在导入时就按当期汇率折好了；没有这个字段的退回 amountCents
 * （那些都是本币行，等价）。
 */
export function base(t: { amountCents: number; baseCents?: number | null }) {
  return t.baseCents ?? t.amountCents;
}

/** 真实支出：花出去且不是自己搬钱 */
export function realSpend(txs: Tx[]) {
  return txs
    .filter((t) => t.direction === 'debit' && !SPEND_EXCLUDED.includes(t.category))
    .reduce((a, t) => a + base(t), 0);
}

/** 真实收入：进账且不是自己搬钱 */
export function realIncome(txs: Tx[]) {
  return txs
    .filter((t) => t.direction === 'credit' && !SPEND_EXCLUDED.includes(t.category))
    .reduce((a, t) => a + base(t), 0);
}

/** 按分类汇总支出，从大到小 */
export function spendByCategory(txs: Tx[]) {
  const m = new Map<string, number>();
  for (const t of txs) {
    if (t.direction !== 'debit' || SPEND_EXCLUDED.includes(t.category)) continue;
    m.set(t.category, (m.get(t.category) ?? 0) + base(t));
  }
  return [...m].sort((a, b) => b[1] - a[1]);
}

/** 待确认的钱：还没定性，单独显示，别混进支出 */
export function pending(txs: Tx[]) {
  const p = txs.filter((t) => t.category === 'uncategorized');
  return {
    count: p.length,
    debitCents: p.filter((t) => t.direction === 'debit').reduce((a, t) => a + base(t), 0),
    creditCents: p.filter((t) => t.direction === 'credit').reduce((a, t) => a + base(t), 0),
  };
}

/** 分 → ¥ 1,234.56 */
export function money(cents: number | null | undefined, withSymbol = true) {
  if (cents == null) return '—';
  const s = (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `${CURRENCY} ${s}` : s;
}

/** 分 → ¥ 1,235（KPI 用，省掉小数少占地方） */
export function moneyRound(cents: number | null | undefined) {
  if (cents == null) return '—';
  return `${CURRENCY} ${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/** 2026-04 → 2026 年 4 月 */
export function periodLabel(period: string) {
  const m = period.match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[1]} 年 ${Number(m[2])} 月` : period;
}
