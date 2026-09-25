import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db';
import { BASE_CURRENCY, CATEGORY_LABELS, SPEND_EXCLUDED, base } from '@/lib/finance';

/**
 * 只读的数据查询 —— 给 AI 做分析、做页面用。
 *
 * 在这之前 AI 只看得见任务和资料库：用户说「做个页面看看今年钱花哪了」，
 * 它手上一笔交易都没有，只能编。这几个工具**只读不写**，边界跟写工具一样
 * 由 zod 挡在门口。
 *
 * 金额一律换成「元」（两位小数的数字）再给模型：库里存的是分，直接给分，
 * 模型十次里总有一次忘了除以 100，页面上的数字就大了一百倍 —— 而且看着很像真的。
 * 跨币种一律按本位币等值（base()）加总，原币另列。
 */

const TX_CATEGORIES = [
  'fixed_cost', 'daily_life', 'tools_subscription', 'big_purchase',
  'salary', 'other_income', 'self_transfer', 'pass_through',
  'balance', 'uncategorized',
] as const;

const yuan = (cents: number | null | undefined) => (cents == null ? null : Math.round(cents) / 100);

/**
 * ⚠ 日期一律按**本地时间**算，别用 UTC 那一套（toISOString 之类）。
 *
 * 交易存的是本地零点（北京时间 7/1 00:00 = UTC 6/30 16:00）。按 UTC 取日期，
 * 每一笔都往前错一天、月初那笔直接掉进上个月 —— 第一版的支出页上就冒出了一个
 * 「6 月只有 6/30 一笔工资」，其实是 7/1 发的。页面其他地方（format.ts）也都是本地时间。
 */
const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date | null | undefined) =>
  d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null;
const month = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

/** 「2026-07-01」→ 本地当天零点。new Date('2026-07-01') 是 UTC 零点，会漏掉本地凌晨那几个小时 */
function startOfDay(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 「2026-09-30」→ 当天结束。用户说「到 9 月底」，9/30 当天的交易也该算进去 */
function endOfDay(s: string) {
  const d = startOfDay(s);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function buildDataTools() {
  return {
    queryFinance: tool({
      description:
        '查银行流水并汇总（只读）。做支出分析、月度对比、「钱花哪了」这类页面或回答时用。' +
        `金额单位是元，已按本位币（${BASE_CURRENCY}）折算。` +
        '「真实支出/收入」剔除了本人账户调拨、余额项、资金往来和待确认 —— ' +
        '待确认单独列在 pending 里，做页面时要单独显示它，别混进支出也别藏起来。',
      inputSchema: z.object({
        from: z.string().optional().describe('起始日期 2026-01-01，不填 = 最早'),
        to: z.string().optional().describe('截止日期 2026-09-30（含当天），不填 = 最新'),
        groupBy: z
          .enum(['category', 'month', 'counterparty'])
          .optional()
          .describe('按分类 / 按月 / 按交易对方汇总，默认按分类'),
        category: z.enum(TX_CATEGORIES).optional().describe('只看某一类'),
        direction: z.enum(['debit', 'credit']).optional().describe('debit 支出 / credit 收入'),
        keyword: z.string().optional().describe('按交易对方、标签、原文模糊搜'),
        listLimit: z
          .number()
          .int()
          .min(0)
          .max(300)
          .optional()
          .describe('另外附上最近多少笔明细，默认 30。只要汇总就填 0'),
      }),
      async execute({ from, to, groupBy = 'category', category, direction, keyword, listLimit = 30 }) {
        const txs = await db.transaction.findMany({
          where: {
            ...(from || to
              ? { date: { ...(from ? { gte: startOfDay(from) } : {}), ...(to ? { lte: endOfDay(to) } : {}) } }
              : {}),
            ...(category ? { category } : {}),
            ...(direction ? { direction } : {}),
            ...(keyword
              ? {
                  OR: [
                    { counterparty: { contains: keyword } },
                    { label: { contains: keyword } },
                    { rawText: { contains: keyword } },
                  ],
                }
              : {}),
          },
          orderBy: { date: 'desc' },
        });

        if (!txs.length) {
          const any = await db.transaction.count();
          return {
            count: 0,
            note: any ? '这个条件下没有交易。' : '库里还没有任何银行流水 —— 用户需要先传账单。',
          };
        }

        const counted = (t: (typeof txs)[number]) => !SPEND_EXCLUDED.includes(t.category);
        const spend = txs.filter((t) => t.direction === 'debit' && counted(t)).reduce((a, t) => a + base(t), 0);
        const income = txs.filter((t) => t.direction === 'credit' && counted(t)).reduce((a, t) => a + base(t), 0);
        const pend = txs.filter((t) => t.category === 'uncategorized');

        const keyOf = (t: (typeof txs)[number]) =>
          groupBy === 'month'
            ? month(t.date)
            : groupBy === 'counterparty'
              ? t.counterparty || t.label || '（未知）'
              : t.category;
        const groups = new Map<string, { spend: number; income: number; count: number }>();
        for (const t of txs) {
          const k = keyOf(t);
          const g = groups.get(k) ?? { spend: 0, income: 0, count: 0 };
          g.count++;
          // 按分类汇总时每一类都要出现（包括调拨、待确认），金额按方向记；
          // 按月 / 按对方汇总时只算真实收支，否则每月都被调拨撑大
          if (groupBy === 'category' || counted(t)) {
            if (t.direction === 'debit') g.spend += base(t);
            else g.income += base(t);
          }
          groups.set(k, g);
        }
        let rows = [...groups].map(([k, g]) => ({
          key: k,
          label: groupBy === 'category' ? (CATEGORY_LABELS[k] ?? k) : k,
          spend: yuan(g.spend),
          income: yuan(g.income),
          count: g.count,
        }));
        rows =
          groupBy === 'month'
            ? rows.sort((a, b) => a.key.localeCompare(b.key))
            : rows.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0)).slice(0, groupBy === 'counterparty' ? 40 : 99);

        return {
          currency: BASE_CURRENCY,
          range: { from: day(txs.at(-1)!.date), to: day(txs[0].date) },
          // 页面上的「数据截至」就填它 —— 不给的话模型会自己编一个日子
          dataAsOf: day(txs[0].date),
          count: txs.length,
          realSpend: yuan(spend),
          realIncome: yuan(income),
          pending: {
            count: pend.length,
            debit: yuan(pend.filter((t) => t.direction === 'debit').reduce((a, t) => a + base(t), 0)),
            credit: yuan(pend.filter((t) => t.direction === 'credit').reduce((a, t) => a + base(t), 0)),
          },
          groupBy,
          groups: rows,
          transactions: txs.slice(0, listLimit).map((t) => ({
            date: day(t.date),
            direction: t.direction,
            amount: yuan(base(t)),
            ...(t.currency !== BASE_CURRENCY ? { original: `${t.currency} ${yuan(t.amountCents)}` } : {}),
            category: CATEGORY_LABELS[t.category] ?? t.category,
            label: t.label,
            counterparty: t.counterparty,
            ...(t.account !== 'main' ? { account: t.account } : {}),
          })),
        };
      },
    }),

    queryHealth: tool({
      description:
        '查家人的体检报告和指标（只读）。做健康趋势页、「血糖这几年怎么变的」这类时用。' +
        '不传 metric 也不传 onlyAbnormal 时只返回成员和报告列表；要具体数值就传其中一个。',
      inputSchema: z.object({
        member: z.string().optional().describe('只看某个人（名字）'),
        metric: z.string().optional().describe('指标名关键字，如「血糖」「胆固醇」「ALT」'),
        category: z.string().optional().describe('指标分类：肝功能/肾功能/血糖/血脂/血常规…'),
        onlyAbnormal: z.boolean().optional().describe('只要异常项'),
        from: z.string().optional().describe('体检日期起 2023-01-01'),
        to: z.string().optional(),
      }),
      async execute({ member, metric, category, onlyAbnormal, from, to }) {
        const members = await db.member.findMany({
          orderBy: { sort: 'asc' },
          select: { id: true, name: true, relation: true, gender: true, birthDate: true },
        });
        const who = member ? members.filter((m) => m.name.includes(member)) : members;
        if (member && !who.length) {
          return { ok: false, error: `没有叫「${member}」的成员。现有：${members.map((m) => m.name).join('、') || '（空）'}` };
        }
        const dateWhere =
          from || to ? { checkDate: { ...(from ? { gte: startOfDay(from) } : {}), ...(to ? { lte: endOfDay(to) } : {}) } } : {};
        const reports = await db.healthReport.findMany({
          where: { memberId: { in: who.map((m) => m.id) }, ...dateWhere },
          orderBy: { checkDate: 'desc' },
          take: 60,
          include: {
            member: { select: { name: true } },
            metrics: { select: { status: true } },
          },
        });

        const out: Record<string, unknown> = {
          members: members.map((m) => ({ name: m.name, relation: m.relation, gender: m.gender, birthDate: day(m.birthDate) })),
          reports: reports.map((r) => ({
            id: r.id,
            member: r.member.name,
            title: r.title,
            type: r.type,
            checkDate: day(r.checkDate),
            institution: r.institution,
            metricCount: r.metrics.length,
            abnormalCount: r.metrics.filter((m) => m.status !== 'normal').length,
          })),
        };

        if (metric || onlyAbnormal || category) {
          const metrics = await db.healthMetric.findMany({
            where: {
              reportId: { in: reports.map((r) => r.id) },
              ...(metric ? { name: { contains: metric } } : {}),
              ...(category ? { category: { contains: category } } : {}),
              ...(onlyAbnormal ? { status: { not: 'normal' } } : {}),
            },
            include: { report: { select: { checkDate: true, member: { select: { name: true } } } } },
            take: 400,
          });
          metrics.sort((a, b) => a.report.checkDate.getTime() - b.report.checkDate.getTime());
          out.metrics = metrics.map((m) => ({
            member: m.report.member.name,
            date: day(m.report.checkDate),
            category: m.category,
            name: m.name,
            value: m.value,
            numValue: m.numValue,
            unit: m.unit,
            referenceRange: m.referenceRange,
            status: m.status,
          }));
        }
        return out;
      },
    }),

    queryPolicies: tool({
      description:
        '查保单台账（只读）。做保险总览、缴费日历、保障一览这类页面时用。' +
        `保费单位是元；premiumBase 是折成本位币（${BASE_CURRENCY}）的，跨币种加总只能用它。` +
        'sumInsured 是保额（元）。',
      inputSchema: z.object({
        insured: z.string().optional().describe('只看某个被保人'),
        status: z.string().optional().describe('默认 active（生效中）；填 all 看全部'),
      }),
      async execute({ insured, status = 'active' }) {
        const policies = await db.policy.findMany({
          where: {
            ...(status !== 'all' ? { status } : {}),
            ...(insured ? { insured: { contains: insured } } : {}),
          },
          orderBy: [{ insured: 'asc' }, { dueMonthDay: 'asc' }],
          include: { payments: { orderBy: { dueOn: 'desc' }, take: 1 } },
        });
        if (!policies.length) {
          const any = await db.policy.count();
          return { count: 0, note: any ? '这个条件下没有保单。' : '库里还没有保单。' };
        }
        return {
          currency: BASE_CURRENCY,
          count: policies.length,
          totalPremiumBase: yuan(policies.reduce((a, p) => a + p.premiumBaseCents, 0)),
          policies: policies.map((p) => ({
            insured: p.insured,
            relation: p.relation,
            insurer: p.insurer,
            product: p.product,
            policyNo: p.policyNo,
            kind: p.kind,
            status: p.status,
            sumInsured: p.sumInsured,
            premium: yuan(p.premiumCents),
            currency: p.currency,
            premiumBase: yuan(p.premiumBaseCents),
            dueMonthDay: p.dueMonthDay,
            coverStart: day(p.coverStart),
            coverEnd: day(p.coverEnd),
            guaranteedUntil: day(p.guaranteedUntil),
            redLine: day(p.redLine),
            redLineNote: p.redLineNote,
            lastPayment: p.payments[0]
              ? { dueOn: day(p.payments[0].dueOn), paidOn: day(p.payments[0].paidOn) }
              : null,
          })),
        };
      },
    }),
  } as const;
}
