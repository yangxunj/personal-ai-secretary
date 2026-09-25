/**
 * 保单命令 —— 让「续保完更新台账」变成一个动作，而不是一串手工编辑。
 *
 * 为什么非做不可：2026-08-27 建了 Policy 表，把缴费日历从手写 HTML 换成
 * 实时渲染，为的是治「手工表静默过期」。但表本身不会自己更新 —— 10 月底
 * 父母那两份一续，保险期间和保费就变了，表里还是旧的，页面照旧显示、
 * 看上去一切正常。病没治好，只是从 HTML 挪进了数据库。
 *
 * 所以有了 policy:renew：一条命令改保险期间、改保费、记一笔缴纳。
 *
 * ★ renew 和 pay 是两件事，别混：
 *   · renew = 进入**新的保险期间**（一年一续的那些、每年周年日续保）
 *   · pay   = 同一份长期合同的**又一期保费**（长期重疾险那种 30 年期、缴 20 年，
 *             每年 8/25 交一期，保险期间从头到尾都是 2019-08-25 ~ 2049-08-24）
 *   用 renew 去记长期重疾险，会把 30 年的保障期改成 1 年 —— 那就把台账写坏了。
 */

/**
 * 折算成本位币的粗略汇率。**只用来排序和汇总，不是记账** ——
 * 保单是手工录的，没有账单那种自带汇率可用，而「今年总共要交多少钱」
 * 差个几十块不影响判断。真要对账以 premiumCents（原币）为准。
 */
const RATE = { CNY: 1, USD: 7.2, HKD: 0.92 };
const toBase = (cents, cur) => Math.round(cents * (RATE[cur] ?? 1));
const yuan = (s) => Math.round(Number(s) * 100); // "2268" / "2268.50" → 分
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

export function policyCommands({ db, positional, flags, line }) {
  /** 按保单号找，找不到就用「包含」再试一次 —— 保单号很长，容易只记得后几位 */
  async function find(no) {
    if (!no) throw new Error('缺少保单号');
    const exact = await db.policy.findUnique({ where: { policyNo: String(no) } });
    if (exact) return exact;
    const like = await db.policy.findMany({ where: { policyNo: { contains: String(no) } } });
    if (like.length === 1) return like[0];
    if (like.length > 1)
      throw new Error(`「${no}」匹配到 ${like.length} 份：${like.map((x) => x.policyNo).join(' / ')}`);
    throw new Error(`没有保单号含「${no}」的记录。跑 policy 看看台账`);
  }

  return {
    /** 保单台账。每次会话开头跑一眼，比翻资料库快 */
    async policy() {
      const all = await db.policy.findMany({
        where: flags.all ? {} : { status: 'active' },
        orderBy: { premiumBaseCents: 'desc' },
        include: { payments: { orderBy: { dueOn: 'desc' }, take: 1 } },
      });
      if (!all.length) return console.log('台账是空的');

      const now = new Date();
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      line();
      for (const p of all) {
        // 下一个缴费日。刚过去 60 天内的不往后推 —— 那正是宽限期，最该盯着
        // 一年期保单看保障到期日（那是已经续过的证据），长期合同才按月日推。
        // 只看月日会催已经办完的事：代办人那份刚续过，月日算出来却是「1 天后」。
        let due = '';
        let t = null;
        if (p.coverEnd) {
          const e = Date.UTC(p.coverEnd.getUTCFullYear(), p.coverEnd.getUTCMonth(), p.coverEnd.getUTCDate());
          if (e >= today && e - today < 400 * 86400000) t = e;
        }
        if (t === null && p.dueMonthDay) {
          const [m, d] = p.dueMonthDay.split('-').map(Number);
          t = Date.UTC(now.getUTCFullYear(), m - 1, d);
          if (t < today - 60 * 86400000) t = Date.UTC(now.getUTCFullYear() + 1, m - 1, d);
        }
        if (t !== null) {
          const n = Math.round((t - today) / 86400000);
          due = (n < 0 ? `⚠ 已过 ${-n} 天` : n === 0 ? '⚠ 就是今天' : `${n} 天后`) + `（${iso(t)}）`;
        }
        console.log(
          `${p.insured}（${p.relation}）· ${p.product}`.slice(0, 60) +
            `\n  ${p.policyNo}  ${p.region.toUpperCase()}  ${p.currency} ${(p.premiumCents / 100).toFixed(2)}` +
            `  缴费日 ${p.dueMonthDay ?? '—'}  ${due}` +
            `\n  ${p.guaranteed ? '保证续保' + (p.guaranteedUntil ? ' 至 ' + iso(p.guaranteedUntil) : '') : '⚠ 不保证续保'}` +
            `  保障 ${iso(p.coverStart)} ~ ${iso(p.coverEnd)}` +
            (p.redLine ? `\n  🔴 红线 ${iso(p.redLine)}` : '') +
            (p.payments[0]
              ? `\n  最近一期：${iso(p.payments[0].dueOn)} 应缴，${p.payments[0].paidOn ? iso(p.payments[0].paidOn) + ' 已缴' : '⚠ 还没确认缴没缴'}`
              : '')
        );
        line();
      }
      const sum = all.reduce((a, b) => a + b.premiumBaseCents, 0) / 100;
      const part = (r) =>
        (all.filter((x) => x.region === r).reduce((a, b) => a + b.premiumBaseCents, 0) / 100).toFixed(0);
      console.log(
        `共 ${all.length} 份 · 年缴合计 CNY ${sum.toFixed(0)}（境内 ${part('cn')} · 境外 ${part('overseas')}）`
      );
    },

    /**
     * 新增一份保单。
     * policy:add "产品名" --no <保单号> --insured 主人 --relation 本人 \
     *   --insurer "众安在线（内地）" --kind medical --region cn \
     *   --premium 2268 --currency CNY --due 10-25 [--sum 6000000] \
     *   [--start 2025-10-26] [--end 2026-10-25] [--first 2018-10-25] \
     *   [--guaranteed] [--until 2045-12-03] [--redline 2027-03-14 --redline-note "..."] \
     *   [--vault <资料条目 id>] [--topic <专题 id>] [--note "..."]
     */
    async 'policy:add'() {
      const product = positional[0];
      const need = { product, no: flags.no, insured: flags.insured, premium: flags.premium };
      const miss = Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
      if (miss.length) return console.error(`缺少必填：${miss.join(' / ')}（product 是第一个位置参数）`);

      const currency = String(flags.currency ?? 'CNY').toUpperCase();
      if (!RATE[currency]) return console.error(`不认识的币种 ${currency}，只支持 ${Object.keys(RATE).join(' / ')}`);
      const premiumCents = yuan(flags.premium);

      const p = await db.policy.create({
        data: {
          product: String(product),
          policyNo: String(flags.no),
          insured: String(flags.insured),
          relation: String(flags.relation ?? '本人'),
          insurer: String(flags.insurer ?? '未填'),
          kind: String(flags.kind ?? 'medical'),
          region: String(flags.region ?? 'cn'),
          sumInsured: flags.sum ? Number(flags.sum) : null, // 整数元，不是分
          premiumCents,
          currency,
          premiumBaseCents: toBase(premiumCents, currency),
          dueMonthDay: flags.due ? String(flags.due) : null,
          coverStart: flags.start ? new Date(String(flags.start)) : null,
          coverEnd: flags.end ? new Date(String(flags.end)) : null,
          firstIssued: flags.first ? new Date(String(flags.first)) : null,
          guaranteed: !!flags.guaranteed,
          guaranteedUntil: flags.until ? new Date(String(flags.until)) : null,
          redLine: flags.redline ? new Date(String(flags.redline)) : null,
          redLineNote: flags['redline-note'] ? String(flags['redline-note']) : null,
          note: flags.note ? String(flags.note) : null,
          vaultItemId: flags.vault ? String(flags.vault) : null,
          topicId: flags.topic ? String(flags.topic) : null,
        },
      });
      console.log(
        `已入台账 ${p.policyNo}：${p.insured}（${p.relation}）· ${p.product}\n` +
          `  ${p.currency} ${(p.premiumCents / 100).toFixed(2)} ≈ CNY ${(p.premiumBaseCents / 100).toFixed(0)} / 年` +
          (p.vaultItemId ? '' : '\n  ⚠ 没挂资料条目（--vault），/insurance 上「条款细节」会跳到搜索页')
      );
    },

    /**
     * 续保：进入新的保险期间。
     * policy:renew <保单号> --from 2026-10-26 --to 2027-10-25 [--premium 2350] [--paid 2026-10-20]
     *
     * 不给 --premium 就沿用旧保费。给了就同时改保费和本位币等值 ——
     * 一年一续的医疗险每年跳年龄段，涨价是常态，别忘了改。
     */
    async 'policy:renew'() {
      const p = await find(positional[0]);
      if (!flags.from || !flags.to) return console.error('缺少 --from / --to（新的保险期间起讫）');

      const currency = p.currency;
      const premiumCents = flags.premium ? yuan(flags.premium) : p.premiumCents;
      const from = new Date(String(flags.from));
      const to = new Date(String(flags.to));

      const updated = await db.policy.update({
        where: { id: p.id },
        data: {
          coverStart: from,
          coverEnd: to,
          premiumCents,
          premiumBaseCents: toBase(premiumCents, currency),
          status: 'active',
        },
      });
      // 续保必然伴随一笔保费，顺手记上 —— 分开两条命令一定会漏
      await db.policyPayment.create({
        data: {
          policyId: p.id,
          dueOn: from,
          paidOn: flags.paid ? new Date(String(flags.paid)) : new Date(),
          amountCents: premiumCents,
          currency,
          baseCents: toBase(premiumCents, currency),
          // 默认认为这笔扣款能在账单里查到：保费通常就是从导进来的那张卡扣的。
          // 真是别处付的（家人代缴、另一张没导入的卡），显式给 --offbook。
          offBook: !!flags.offbook,
          note: flags.note ? String(flags.note) : null,
        },
      });

      const delta = premiumCents - p.premiumCents;
      console.log(
        `已续保 ${p.policyNo}（${p.insured}）\n` +
          `  保障期 ${iso(p.coverStart)}~${iso(p.coverEnd)} → ${iso(from)}~${iso(to)}\n` +
          `  保费 ${currency} ${(p.premiumCents / 100).toFixed(2)}` +
          (delta
            ? ` → ${(premiumCents / 100).toFixed(2)}（${delta > 0 ? '+' : ''}${(delta / 100).toFixed(2)}，${((delta / p.premiumCents) * 100).toFixed(1)}%）`
            : '（未变）') +
          `\n  已记一笔缴纳${flags.offbook ? '（标为账外 —— 不经导入的那张卡，账单里查不到）' : ''}` +
          (updated.redLine && updated.redLine > to
            ? `\n  🔴 红线 ${iso(updated.redLine)} 还在前面，下一次续保仍不能断`
            : '')
      );
    },

    /**
     * 记一笔保费缴纳，不动保险期间。
     * policy:pay <保单号> [--on 2026-08-25] [--amount 1321] [--via 微信自动扣款] [--tx <交易 id>]
     *
     * 用在长期合同的分期缴费上：比如 30 年保障、缴 20 年，每年固定日
     * 交一期，保险期间从头到尾不变。这种拿 renew 去记会把保障期改成 1 年。
     */
    async 'policy:pay'() {
      const p = await find(positional[0]);
      const amountCents = flags.amount ? yuan(flags.amount) : p.premiumCents;
      const on = flags.on ? new Date(String(flags.on)) : new Date();

      const pay = await db.policyPayment.create({
        data: {
          policyId: p.id,
          dueOn: on,
          paidOn: on,
          amountCents,
          currency: p.currency,
          baseCents: toBase(amountCents, p.currency),
          transactionId: flags.tx ? String(flags.tx) : null,
          // 对上了银行流水当然不算账外；对不上的也默认不算 —— 保费多半就是
          // 从导进来的那张卡扣的，标成账外反而会让人以为查不到
          offBook: flags.tx ? false : !!flags.offbook,
          note: flags.via ? String(flags.via) : flags.note ? String(flags.note) : null,
        },
      });
      const n = await db.policyPayment.count({ where: { policyId: p.id } });
      console.log(
        `已记 ${p.policyNo}（${p.insured}）一笔缴费：${iso(on)} ${p.currency} ${(amountCents / 100).toFixed(2)}` +
          (pay.note ? ` · ${pay.note}` : '') +
          (pay.offBook ? '\n  标为账外 —— 不经导入的那张卡，账单里查不到' : '') +
          `\n  这份保单累计记了 ${n} 笔`
      );
    },
  };
}
