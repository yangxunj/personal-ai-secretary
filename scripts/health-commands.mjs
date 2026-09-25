/**
 * 健康相关的 CLI 命令，挂进 secretary.mjs。
 *
 * 为什么单独一个文件：secretary.mjs 已经七百多行了，健康这块还会长（趋势、
 * 疫苗、定期检查），再往里塞会变成谁也不敢改的大文件。
 *
 * **入库方式跟账单不一样，这是刻意的。** 账单是文本型 PDF，pdftotext 提取精确，
 * 所以有一条 python 解析流水线；体检报告是扫描件/照片，我自己读图比 OCR 再喂
 * 给 LLM 准（少一次转录、还能看到版式里的 ↑↓ 箭头和分区）。所以这里没有解析器，
 * 只有「把我读出来的结果写进库」的入口 —— 我读，然后交一份 JSON 给它。
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';

/** 参考范围形如 "3.9 - 6.1" / "<5.2" / "阴性"，只有能取出上下界的才判高低 */
function judge(numValue, range) {
  if (numValue == null || !range) return null;
  const txt = String(range).replace(/[，,]/g, '.').trim();

  const between = txt.match(/(-?\d+(?:\.\d+)?)\s*[-~–—至]\s*(-?\d+(?:\.\d+)?)/);
  if (between) {
    const lo = Number(between[1]);
    const hi = Number(between[2]);
    if (numValue < lo) return 'low';
    if (numValue > hi) return 'high';
    return 'normal';
  }
  const upper = txt.match(/^[<≤]\s*(-?\d+(?:\.\d+)?)/);
  if (upper) return numValue > Number(upper[1]) ? 'high' : 'normal';
  const lower = txt.match(/^[>≥]\s*(-?\d+(?:\.\d+)?)/);
  if (lower) return numValue < Number(lower[1]) ? 'low' : 'normal';
  return null;
}

/** "5.6" → 5.6；"阴性" → null；"1.2×10^9" 这类带符号的取前导数字 */
function toNum(v) {
  const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const STATUS_LABEL = { normal: '正常', high: '偏高', low: '偏低', abnormal: '异常' };

/**
 * 复查时限往往是相对的（「一月后复查」「3-6 个月后复查」），基准是体检那天。
 * 给 `months` 就从 checkDate 往后推，给 `due` 就用绝对日期。
 *
 * 「3-6 个月」这种区间取**下限**：早提醒一次没损失，晚了就错过窗口。
 */
function dueFrom(checkDate, fu) {
  if (fu.due) return new Date(fu.due);
  if (fu.months == null) return null;
  const d = new Date(checkDate);
  d.setMonth(d.getMonth() + Number(fu.months));
  return d;
}

export function healthCommands({ db, positional, flags, money, line, ingestFile }) {
  return {
    async members() {
      const list = await db.member.findMany({
        orderBy: { sort: 'asc' },
        include: { _count: { select: { reports: true } } },
      });
      if (list.length === 0) return console.log('还没有家庭成员。用 member:add 添加。');
      for (const m of list) {
        const age = m.birthDate
          ? Math.floor((Date.now() - m.birthDate.getTime()) / 31557600000)
          : null;
        line();
        console.log(`${m.relation}  ${m.name}${age != null ? `  ${age} 岁` : ''}   id=${m.id}`);
        const bits = [];
        if (m.gender) bits.push(m.gender === 'male' ? '男' : '女');
        if (m.birthDate) bits.push(m.birthDate.toISOString().slice(0, 10));
        if (m.bloodType) bits.push(`${m.bloodType} 型`);
        if (m.heightCm) bits.push(`${m.heightCm}cm`);
        if (m.weightKg) bits.push(`${m.weightKg}kg`);
        if (bits.length) console.log('  ' + bits.join(' · '));
        if (m.chronicDiseases) console.log(`  ⚠ 慢性病: ${m.chronicDiseases}`);
        if (m.allergies) console.log(`  ⚠ 过敏: ${m.allergies}`);
        console.log(`  报告 ${m._count.reports} 份`);
        if (m.notes) console.log(`  备注: ${m.notes}`);
      }
      line();
      console.log(`共 ${list.length} 位`);
    },

    async 'member:add'() {
      const name = positional[0];
      if (!name) return console.error('用法: member:add "家人" --relation 父亲 [--gender male] [--birth 1956-03-15]');
      const m = await db.member.create({
        data: {
          name,
          relation: String(flags.relation ?? '其他'),
          gender: flags.gender ? String(flags.gender) : null,
          birthDate: flags.birth ? new Date(String(flags.birth)) : null,
          bloodType: flags.blood ? String(flags.blood) : null,
          heightCm: flags.height ? Number(flags.height) : null,
          weightKg: flags.weight ? Number(flags.weight) : null,
          chronicDiseases: String(flags.chronic ?? ''),
          allergies: flags.allergies ? String(flags.allergies) : null,
          notes: flags.notes ? String(flags.notes) : null,
          sort: Number(flags.sort ?? 99),
        },
      });
      console.log(`已添加成员 ${m.id}: ${m.relation} ${m.name}`);
    },

    async 'member:update'() {
      const id = positional[0];
      if (!id) return console.error('缺少 id');
      const data = {};
      if (flags.relation !== undefined) data.relation = String(flags.relation);
      if (flags.gender !== undefined) data.gender = String(flags.gender);
      if (flags.birth !== undefined) data.birthDate = new Date(String(flags.birth));
      if (flags.blood !== undefined) data.bloodType = String(flags.blood);
      if (flags.height !== undefined) data.heightCm = Number(flags.height);
      if (flags.weight !== undefined) data.weightKg = Number(flags.weight);
      if (flags.chronic !== undefined) data.chronicDiseases = String(flags.chronic);
      if (flags.allergies !== undefined) data.allergies = String(flags.allergies);
      if (flags.notes !== undefined) data.notes = String(flags.notes);
      if (flags.sort !== undefined) data.sort = Number(flags.sort);
      const m = await db.member.update({ where: { id }, data });
      console.log(`已更新 ${m.name}`);
    },

    /**
     * 把我读报告读出来的结果写进库。
     *
     *   health:import <report.json> [--attach <原件路径>…]
     *
     * JSON 形状（字段名照抄 familyHealthManager 的设计，那部分是对的）：
     * {
     *   "member": "主人",            // 姓名，要能在 Member 表里找到
     *   "type": "体检报告",
     *   "title": "2026 年某某医院体检",
     *   "checkDate": "2026-01-04",
     *   "institution": "某某医院健康管理中心",
     *   "summary": "总检结论，整段 Markdown",
     *   "metrics": [
     *     { "category": "肾功能", "name": "肌酐", "value": "98",
     *       "unit": "umol/L", "referenceRange": "57 - 97", "status": "high",
     *       "note": "总检结论里点名了" }
     *   ]
     * }
     *
     * status 可以不给 —— 能从 value + referenceRange 算出来的会自动判，
     * 但**报告上明确标了箭头的以报告为准**，所以给了就不覆盖。
     *
     * 另外可以给 followUps，报告里带时限的医嘱会变成任务页上的待办：
     *   "followUps": [
     *     { "title": "复查尿酮体（主人）", "months": 1, "priority": 1,
     *       "detail": "医生建议一月后复查，排除饥饿等生理性原因" }
     *   ]
     * `months` 从体检日期往后推，也可以直接给 `due": "2026-06-30"`。
     * 区间（「3-6 个月」）取下限。重导报告按 sourceKey 认领已有任务更新，
     * **已经标成 done/cancelled 的不会被复活。**
     */
    async 'health:import'() {
      const src = positional[0];
      if (!src) return console.error('用法: health:import <report.json> [--attach <原件>] [--attach <原件2>]');
      const payload = JSON.parse(await readFile(path.resolve(src), 'utf8'));

      const member = await db.member.findFirst({ where: { name: payload.member } });
      if (!member) {
        return console.error(`找不到成员「${payload.member}」。先跑 members 看看有谁，或用 member:add 添加。`);
      }
      if (!payload.checkDate) return console.error('缺少 checkDate（体检日期），列表和趋势都按它排，不能省');

      const checkDate = new Date(payload.checkDate);
      // 同一个人同一天同一种报告 = 重导覆盖，不是叠加（跟 bill:import 一个规矩）
      const existing = await db.healthReport.findFirst({
        where: { memberId: member.id, checkDate, type: payload.type ?? '体检报告' },
      });

      const body = {
        memberId: member.id,
        type: payload.type ?? '体检报告',
        title: payload.title ?? `${checkDate.toISOString().slice(0, 10)} ${payload.type ?? '体检报告'}`,
        checkDate,
        institution: payload.institution ?? null,
        summary: payload.summary ?? null,
        notes: payload.notes ?? null,
      };

      let report;
      let replaced = 0;
      if (existing) {
        report = await db.healthReport.update({ where: { id: existing.id }, data: body });
        replaced = (await db.healthMetric.deleteMany({ where: { reportId: report.id } })).count;
      } else {
        report = await db.healthReport.create({ data: body });
      }

      const metrics = (payload.metrics ?? []).map((m) => {
        const numValue = toNum(m.value);
        // 报告上标了箭头就听报告的；没标才用参考范围反推
        const status = m.status ?? judge(numValue, m.referenceRange) ?? 'normal';
        return {
          reportId: report.id,
          category: m.category ?? '其他',
          name: m.name,
          value: String(m.value ?? ''),
          numValue,
          unit: m.unit ?? null,
          referenceRange: m.referenceRange ?? null,
          status,
          note: m.note ?? null,
        };
      });
      if (metrics.length) await db.healthMetric.createMany({ data: metrics });

      for (const p of [].concat(flags.attach ?? []).filter((x) => typeof x === 'string')) {
        const already = await db.attachment.findFirst({
          where: { healthReportId: report.id, filename: path.basename(p) },
        });
        if (already) {
          console.log(`  原件已在平台里，跳过：${already.filename}`);
          continue;
        }
        const meta = await ingestFile(p);
        await db.attachment.create({
          data: { ...meta, category: '体检', healthReportId: report.id, uploadedBy: 'secretary',
                  note: `${body.title} 原件` },
        });
        console.log(`  原件已收入：${meta.filename}`);
      }

      // ---- 复查提醒 ----
      // 报告里的「一月后复查」「定期随访」如果只躺在 summary 里，到点没人看。
      // 抽成任务，复用任务页现成的机制（不另建提醒表）。
      // 靠 sourceKey 认领，重导同一份报告是更新不是重建。
      let fuNew = 0;
      let fuUpd = 0;
      for (const fu of payload.followUps ?? []) {
        if (!fu.title) continue;
        const key = `health:${report.id}:${fu.title}`;
        const data = {
          title: fu.title,
          detail:
            (fu.detail ? fu.detail + '\n\n' : '') +
            `来自 ${member.name} ${checkDate.toISOString().slice(0, 10)} ${body.title}` +
            `（报告 id=${report.id}）。复查完把结果告诉我，我更新这条。`,
          category: '健康',
          priority: Number(fu.priority ?? 2),
          dueDate: dueFrom(checkDate, fu),
        };
        const existing = await db.task.findUnique({ where: { sourceKey: key } });
        if (existing) {
          // 已经办完的不要复活 —— 只更新还没办的那些
          if (['done', 'cancelled'].includes(existing.status)) continue;
          await db.task.update({ where: { id: existing.id }, data });
          fuUpd++;
        } else {
          await db.task.create({ data: { ...data, sourceKey: key } });
          fuNew++;
        }
      }

      const bad = metrics.filter((m) => m.status !== 'normal');
      console.log(
        `已导入 ${member.name} · ${body.title}：${metrics.length} 项指标` +
        (replaced ? `（覆盖了原有 ${replaced} 项）` : '')
      );
      if (bad.length) {
        console.log(`  ⚠ ${bad.length} 项不正常：`);
        for (const m of bad) {
          console.log(`     ${STATUS_LABEL[m.status] ?? m.status}  ${m.name} ${m.value}${m.unit ?? ''}` +
                      (m.referenceRange ? `  （参考 ${m.referenceRange}）` : ''));
        }
      } else if (metrics.length) {
        console.log('  所有指标都在参考范围内');
      }
      if (fuNew || fuUpd) {
        console.log(`  复查提醒：新建 ${fuNew} 条，更新 ${fuUpd} 条（任务页「健康」分类）`);
      }
      console.log(`  报告 id=${report.id}`);
    },

    async health() {
      const who = flags.member ? String(flags.member) : null;
      const reports = await db.healthReport.findMany({
        where: who ? { member: { name: { contains: who } } } : {},
        orderBy: { checkDate: 'desc' },
        include: {
          member: { select: { name: true, relation: true } },
          attachments: true,
          _count: { select: { metrics: true } },
        },
      });
      if (reports.length === 0) return console.log('还没有健康报告。用 health:import 导入。');
      for (const r of reports) {
        const bad = await db.healthMetric.count({ where: { reportId: r.id, status: { not: 'normal' } } });
        line();
        console.log(`${r.checkDate.toISOString().slice(0, 10)}  ${r.member.name}（${r.member.relation}）  ${r.title}   id=${r.id}`);
        if (r.institution) console.log(`  机构: ${r.institution}`);
        console.log(`  ${r._count.metrics} 项指标${bad ? `，⚠ ${bad} 项不正常` : '，全部正常'}`);
        for (const a of r.attachments) console.log(`  [原件] ${a.filename}`);
      }
      line();
      console.log(`共 ${reports.length} 份`);
    },

    async 'health:show'() {
      const id = positional[0];
      if (!id) return console.error('用法: health:show <报告 id> [--abnormal]');
      const r = await db.healthReport.findUnique({
        where: { id },
        include: { member: true, attachments: true, metrics: { orderBy: [{ category: 'asc' }, { name: 'asc' }] } },
      });
      if (!r) return console.error('未找到该报告');
      line();
      console.log(`${r.member.name}（${r.member.relation}）  ${r.title}`);
      console.log(`${r.checkDate.toISOString().slice(0, 10)}${r.institution ? '  ·  ' + r.institution : ''}`);
      if (r.summary) {
        line();
        console.log(r.summary);
      }
      const list = flags.abnormal ? r.metrics.filter((m) => m.status !== 'normal') : r.metrics;
      let cat = '';
      for (const m of list) {
        if (m.category !== cat) {
          cat = m.category;
          line();
          console.log(`【${cat}】`);
        }
        const mark = m.status === 'normal' ? '  ' : '⚠ ';
        console.log(
          `${mark}${m.name.padEnd(16)} ${String(m.value + (m.unit ?? '')).padEnd(14)}` +
          `${m.referenceRange ? '参考 ' + m.referenceRange : ''}` +
          `${m.status !== 'normal' ? '  ← ' + (STATUS_LABEL[m.status] ?? m.status) : ''}`
        );
        if (m.note) console.log(`     ${m.note}`);
      }
      if (r.attachments.length) {
        line();
        for (const a of r.attachments) console.log(`[原件] ${a.filename}`);
      }
      line();
    },

    /**
     * 删掉一份报告。
     *
     * 为什么需要它：`health:import` 靠「同一人 + 同一天 + 同一类型」认重，
     * **日期一旦弄错，重导只会多出一份，不会盖掉旧的**。我第一次导主人那份
     * 就把体检日期写成了报告创建日期，只能删了重来。
     * 指标随报告级联删；原件不删（那是文件，跟解析结果不是一回事）。
     */
    async 'health:rm'() {
      const id = positional[0];
      if (!id) return console.error('用法: health:rm <报告 id>');
      const r = await db.healthReport.findUnique({
        where: { id },
        include: { member: { select: { name: true } }, _count: { select: { metrics: true, attachments: true } } },
      });
      if (!r) return console.error('未找到该报告');
      await db.healthReport.delete({ where: { id } });
      console.log(
        `已删除 ${r.member.name} · ${r.title}（${r.checkDate.toISOString().slice(0, 10)}），` +
        `连带 ${r._count.metrics} 项指标`
      );
      if (r._count.attachments) {
        console.log(`  ⚠ 原来挂着 ${r._count.attachments} 个原件，文件还在，但已经没有报告认领了 —— 用 files 找出来重挂或删掉`);
      }
      // 复查任务不跟着删：主人可能已经去复查了，勾掉的记录比「跟报告保持一致」值钱。
      // 但要说出来，不然它们会挂在任务页上指着一个不存在的报告 id。
      const orphans = await db.task.findMany({
        where: { sourceKey: { startsWith: `health:${id}:` }, status: { notIn: ['done', 'cancelled'] } },
        select: { id: true, title: true },
      });
      if (orphans.length) {
        console.log(`  ⚠ 还有 ${orphans.length} 条复查任务是这份报告生成的，没有跟着删：`);
        for (const t of orphans) console.log(`      ${t.title}   id=${t.id}`);
        console.log('    重导报告会新建一批（报告 id 变了，认领不上）—— 重导完把这些旧的 task:update --status cancelled');
      }
    },

    /** 同一个指标跨报告拉平，看走势。一份报告谈不上趋势，两份起才有意义。 */
    async 'health:trend'() {
      const name = positional[0];
      if (!name) return console.error('用法: health:trend "血糖" [--member 家人]');
      const rows = await db.healthMetric.findMany({
        where: {
          name: { contains: name },
          ...(flags.member ? { report: { member: { name: { contains: String(flags.member) } } } } : {}),
        },
        include: { report: { include: { member: { select: { name: true } } } } },
      });
      if (rows.length === 0) return console.log(`没有找到含「${name}」的指标。`);

      const byPerson = new Map();
      for (const m of rows) {
        const k = m.report.member.name;
        if (!byPerson.has(k)) byPerson.set(k, []);
        byPerson.get(k).push(m);
      }
      for (const [person, list] of byPerson) {
        list.sort((a, b) => a.report.checkDate - b.report.checkDate);
        line();
        console.log(`${person} · ${name}`);
        for (const m of list) {
          const mark = m.status === 'normal' ? '  ' : '⚠ ';
          console.log(
            `${mark}${m.report.checkDate.toISOString().slice(0, 10)}  ${m.name}  ` +
            `${m.value}${m.unit ?? ''}${m.referenceRange ? '  （参考 ' + m.referenceRange + '）' : ''}`
          );
        }
        if (list.length === 1) console.log('  只有一次记录，还看不出走势');
      }
      line();
    },
  };
}
