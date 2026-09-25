import { db } from '@/lib/db';
import { BASE_CURRENCY } from '@/lib/finance';
import PageHeader from '@/components/PageHeader';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * 保险页 —— **不在底栏**，入口从「全家保险」专题页进来。
 *
 * 为什么建了表却不占底栏那一格：判据是「要不要建表」（要 —— 11 份保单同样的
 * 十几个维度，缴费日是条真时间序列），而底栏那一格的判据是「高不高频」。
 * 保险一年想起几次，占一格得把别的挤掉（文稿已经因为同样的原因被挤走过一次）。
 * 保单数过 20 份、或者主人开始每月都点进来，那时再谈毕业。
 *
 * 这一页只管**事实**：谁的、多少钱、什么时候交、断了会怎样。
 * **判断**（条款怎么解读、告知瑕疵怎么处置、红线为什么危险）留在专题呈现页 ——
 * 那些是文章，塞进表格只会两头不讨好。
 *
 * 三张表全部从 Policy 实时算：缴费日历、按人汇总、红线。之前它们是我手写的
 * HTML，加一份保单要手改三处，而手工表会**静默过期** —— 保费交了、保单续了，
 * 页面还是旧的，看上去却一切正常。
 */

const KIND: Record<string, { label: string; cls: string }> = {
  medical: { label: '医疗', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' },
  critical: { label: '重疾', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400' },
  life: { label: '寿险', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300' },
  cancer: { label: '防癌', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
};

const money = (cents: number, cur: string) =>
  `${cur} ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const base = (cents: number) => `${BASE_CURRENCY} ${Math.round(cents / 100).toLocaleString('en-US')}`;
const wan = (n: number | null) => (n == null ? null : n >= 10000 ? `${n / 10000} 万` : n.toLocaleString('en-US'));
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/**
 * 下一个缴费日：把 "MM-DD" 投到今年，已经过了就投到明年。
 *
 * ★ 但**刚过去 60 天内的不往后推**。这一条是被真事逼出来的：家人那份重疾险
 * 缴费日 8/25，2026-08-27 打开页面时显示「363 天后」—— 而那笔前天刚到期、
 * 还没确认扣款成功，是全表最紧急的一件事，却被排到了最末尾。
 *
 * 60 天不是随手取的：内地保单的宽限期普遍就是 60 天（复星条款 4.2、太保
 * 条款 2.4.2 都是），逾期未交在这个窗口内还能补救，出了窗口合同就中止了。
 * 所以这段时间正是最该盯着的，绝不能从视野里消失。
 */
function nextDue(p: { dueMonthDay: string | null; coverEnd: Date | null }): { date: Date; days: number } | null {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  // ① 一年期保单：下一次要动手的日子就是当期保障到期日，直接用它。
  //
  // ★ 这一条是被真事逼出来的第二个错。代办人那份 2026-08-27 刚续过，新保障期
  // 是 2026-08-30 ~ 2027-08-29；但 dueMonthDay 是 "08-29"，只看月日就投到了
  // 2026-08-29，页面于是喊「1 天后，必须主动去重新投保」—— 催一件两天前
  // 就办完的事。保障期是已经续过的证据，月日不是。
  const ANNUAL = 400 * 86400000;
  if (p.coverEnd) {
    const end = Date.UTC(p.coverEnd.getUTCFullYear(), p.coverEnd.getUTCMonth(), p.coverEnd.getUTCDate());
    if (end >= today && end - today < ANNUAL) return { date: new Date(end), days: Math.round((end - today) / 86400000) };
  }

  // ② 长期合同（保到几十年后、或终身的那些）：保障期跟缴费日无关，
  //    每年照旧交一期，只能按月日推。
  if (!p.dueMonthDay) return null;
  const [m, d] = p.dueMonthDay.split('-').map(Number);
  let t = Date.UTC(now.getUTCFullYear(), m - 1, d);
  // 刚过去 60 天内的不往后推 —— 那正是宽限期，还能补救，绝不能从视野里消失
  const GRACE = 60 * 86400000;
  if (t < today - GRACE) t = Date.UTC(now.getUTCFullYear() + 1, m - 1, d);
  return { date: new Date(t), days: Math.round((t - today) / 86400000) };
}

/** 距今天还有多少天（可为负） */
function daysTo(d: Date | null) {
  if (!d) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - today) / 86400000);
}

export default async function InsurancePage() {
  const policies = await db.policy.findMany({
    where: { status: 'active' },
    orderBy: { premiumBaseCents: 'desc' },
    include: { payments: { orderBy: { dueOn: 'desc' }, take: 1 } },
  });

  const total = policies.reduce((a, b) => a + b.premiumBaseCents, 0);
  const cnTotal = policies.filter((p) => p.region === 'cn').reduce((a, b) => a + b.premiumBaseCents, 0);
  const overseasTotal = policies.filter((p) => p.region === 'overseas').reduce((a, b) => a + b.premiumBaseCents, 0);
  const notGuaranteed = policies.filter((p) => !p.guaranteed);

  // 缴费日历：按「还有多少天」排
  const calendar = policies
    .map((p) => ({ p, due: nextDue(p) }))
    .filter((x): x is { p: (typeof policies)[number]; due: { date: Date; days: number } } => !!x.due)
    .sort((a, b) => a.due.days - b.due.days);
  // 注意：排序仍按日期。已缴的那笔留在原位（时间上它就是最近的一笔），
  // 但配色从红转绿 —— 位置传达「什么时候」，颜色传达「要不要管」。

  // 红线：按最近的排
  const redLines = policies
    .filter((p) => p.redLine)
    .map((p) => ({ p, days: daysTo(p.redLine)! }))
    .sort((a, b) => a.days - b.days);

  // 按人汇总
  const byPerson = new Map<string, typeof policies>();
  for (const p of policies) {
    const k = `${p.insured}|${p.relation}`;
    byPerson.set(k, [...(byPerson.get(k) ?? []), p]);
  }
  const people = [...byPerson.entries()].sort(
    (a, b) =>
      b[1].reduce((s, x) => s + x.premiumBaseCents, 0) - a[1].reduce((s, x) => s + x.premiumBaseCents, 0)
  );

  return (
    <>
      <PageHeader
        title="保险"
        subtitle={`${policies.length} 份保单 · ${people.length} 个人 · 年缴 ${base(total)}`}
        back="/topics"
      />

      <div className="px-4 py-3 space-y-5">
        {/* ---------- 总览 ---------- */}
        <section className="surface rounded-2xl border p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-semibold tabular-nums">{base(total)}</div>
              <div className="muted text-[11px] mt-0.5">年缴合计</div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums">{base(cnTotal)}</div>
              <div className="muted text-[11px] mt-0.5">境内 {policies.filter((p) => p.region === 'cn').length} 份</div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums">{base(overseasTotal)}</div>
              <div className="muted text-[11px] mt-0.5">境外 {policies.filter((p) => p.region === 'overseas').length} 份</div>
            </div>
          </div>
          <p className="muted text-[11px] mt-3 leading-relaxed">
            外币按粗略汇率折算，只用来排序和汇总，对账以原币为准。标了
            <b>账外</b>的那几笔不经导入的银行账单 —— 财务页的「真实支出」看不到它们。
          </p>
        </section>

        {/* ---------- 缴费日历 ---------- */}
        <section>
          <h2 className="text-[13px] font-semibold mb-2 px-0.5">接下来要交的</h2>
          <div className="space-y-1.5">
            {calendar.map(({ p, due }) => {
              // 已经过了缴费日 —— 但要先看这一期到底缴没缴。
              // 只有「过了日子、还没有对应缴费记录」才值得标红；已经确认缴了的
              // 继续喊「先确认扣款」就是在制造假警报，而假警报比没有警报更糟：
              // 喊过几次狼来了，真出事那次也不会有人当真。
              const last = p.payments[0];
              const paidThisCycle =
                !!last?.paidOn &&
                Math.abs(last.dueOn.getTime() - due.date.getTime()) < 45 * 86400000;
              const passed = due.days < 0 && !paidThisCycle;
              const soon = due.days >= 0 && due.days <= 90;
              return (
                <div
                  key={p.id}
                  className="surface rounded-xl border px-3 py-2.5 flex items-center gap-3"
                  style={
                    passed
                      ? { borderColor: 'rgb(239 68 68 / 0.5)', background: 'rgb(239 68 68 / 0.06)' }
                      : { borderColor: 'var(--border)' }
                  }
                >
                  <div className="w-14 shrink-0 text-center">
                    <div
                      className={`text-[13px] font-semibold tabular-nums ${
                        passed ? 'text-red-600 dark:text-red-400' : soon ? 'text-amber-600 dark:text-amber-400' : ''
                      }`}
                    >
                      {`${`${due.date.getUTCMonth() + 1}`.padStart(2, '0')}/${`${due.date.getUTCDate()}`.padStart(2, '0')}`}
                    </div>
                    <div
                      className={`text-[10px] ${
                        passed ? 'text-red-600 dark:text-red-400' : paidThisCycle ? 'text-emerald-600 dark:text-emerald-400' : 'muted'
                      }`}
                    >
                      {paidThisCycle
                        ? '已缴'
                        : due.days === 0
                          ? '就是今天'
                          : due.days < 0
                            ? `已过 ${-due.days} 天`
                            : `${due.days} 天后`}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] truncate">
                      <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded mr-1.5 align-middle ${KIND[p.kind]?.cls}`}>
                        {KIND[p.kind]?.label}
                      </span>
                      <b>{p.insured}</b>
                      <span className="muted"> · {p.insurer.replace(/（.*/, '')}</span>
                    </div>
                    <div
                      className={`text-[11px] truncate mt-0.5 ${
                        passed ? 'text-red-600 dark:text-red-400' : paidThisCycle ? 'text-emerald-600 dark:text-emerald-400' : 'muted'
                      }`}
                    >
                      {passed
                        ? '⚠ 缴费日已过，先确认扣款成功了没有'
                        : paidThisCycle
                          ? `${last!.paidOn!.toISOString().slice(0, 10)} 已缴${last!.note ? ' · ' + last!.note.replace(/（.*/, '') : ''}`
                          : p.guaranteed
                            ? '保证续保 —— 但保费还是要按时到账'
                            : '⚠ 不保证续保，到期前必须主动去重新投保'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[13px] font-semibold tabular-nums">{money(p.premiumCents, p.currency)}</div>
                    {p.currency !== BASE_CURRENCY && <div className="muted text-[10px] tabular-nums">≈ {base(p.premiumBaseCents)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------- 红线 ---------- */}
        {redLines.length > 0 && (
          <section>
            <h2 className="text-[13px] font-semibold mb-2 px-0.5">断了就买不回来的日子</h2>
            <div className="space-y-1.5">
              {redLines.map(({ p, days }) => (
                <div
                  key={p.id}
                  className="rounded-xl border px-3 py-2.5"
                  style={{ borderColor: 'rgb(239 68 68 / 0.4)', background: 'rgb(239 68 68 / 0.05)' }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[13px]">
                      <b>{p.insured}</b>
                      <span className="muted"> · {p.relation} · {p.product.replace(/（.*/, '')}</span>
                    </div>
                    <div className="text-[13px] font-semibold tabular-nums text-red-600 dark:text-red-400 shrink-0">
                      {iso(p.redLine)}
                    </div>
                  </div>
                  <p className="muted text-[11px] mt-1 leading-relaxed">
                    还有 {Math.floor(days / 30)} 个月 · {p.redLineNote}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---------- 不保证续保 ---------- */}
        <section>
          <h2 className="text-[13px] font-semibold mb-2 px-0.5">
            不保证续保的 {notGuaranteed.length} 份 —— 每年都得自己去办
          </h2>
          <div className="surface rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <p className="text-[12px] leading-relaxed muted">
              这几份到期不会自动延续：保险期间届满要重新申请、经保险人同意才成立新合同。
              它们能一直保着，靠的是「对保障期间连续的保单，按照<b>首年投保时</b>的健康告知核保」——
              断一次，这个保护就没了。
            </p>
            <div className="mt-2.5 space-y-1">
              {notGuaranteed.map((p) => (
                <div key={p.id} className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="truncate">
                    <b>{p.insured}</b>
                    <span className="muted"> · {p.dueMonthDay?.replace('-', '/')} 到期</span>
                  </span>
                  <span className="muted tabular-nums shrink-0">
                    首次投保 {iso(p.firstIssued)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- 按人 ---------- */}
        <section>
          <h2 className="text-[13px] font-semibold mb-2 px-0.5">每个人保了什么</h2>
          <div className="space-y-2">
            {people.map(([key, list]) => {
              const [name, relation] = key.split('|');
              const sum = list.reduce((a, b) => a + b.premiumBaseCents, 0);
              return (
                <div key={key} className="surface rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <div className="text-[14px] font-semibold">
                      {name}
                      <span className="muted font-normal text-[12px]"> · {relation}</span>
                    </div>
                    <div className="muted text-[11px] tabular-nums shrink-0">{base(sum)} / 年</div>
                  </div>
                  <div className="space-y-1.5">
                    {list.map((p) => (
                      <div key={p.id} className="text-[12px]">
                        <div className="flex items-baseline gap-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${KIND[p.kind]?.cls}`}>
                            {KIND[p.kind]?.label}
                          </span>
                          <span className="truncate flex-1">{p.product}</span>
                          <span className="muted tabular-nums shrink-0">{money(p.premiumCents, p.currency)}</span>
                        </div>
                        <div className="muted text-[11px] mt-0.5 pl-0.5">
                          {p.insurer} · {p.policyNo}
                          {p.sumInsured != null && ` · 保额 ${p.currency === 'CNY' ? wan(p.sumInsured) : wan(p.sumInsured)}`}
                          {p.guaranteed
                            ? ` · 保证续保${p.guaranteedUntil ? '至 ' + iso(p.guaranteedUntil) : ''}`
                            : ' · ⚠ 不保证续保'}
                        </div>
                        {/* 资料库没有详情路由，只有 /vault?c= 分类视图 —— 用搜索页按保单号直达，
                            那是唯一能精确定位到一条的入口 */}
                        <Link
                          href={`/search?q=${encodeURIComponent(p.policyNo)}`}
                          className="inline-block mt-1 text-[11px] text-brand-600 dark:text-brand-400 active:opacity-60"
                        >
                          条款细节与原件 →
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="pt-1">
          <Link
            href="/topics"
            className="block surface rounded-xl border px-3 py-3 text-[13px] active:opacity-60"
            style={{ borderColor: 'var(--border)' }}
          >
            条款解读、告知瑕疵、保障缺口的分析 → <b>「全家保险」专题</b>
            <div className="muted text-[11px] mt-0.5">
              这一页只列事实。为什么某条红线危险、某份保单哪里有敞口，都写在专题的呈现页里。
            </div>
          </Link>
        </div>
      </div>
    </>
  );
}
