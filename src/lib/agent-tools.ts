import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { removeStored, type StoredFile } from '@/lib/ingest';
import { buildDataTools } from '@/lib/data-tools';
import { buildPageTools } from '@/lib/page-tools';

/**
 * 网页里那个 AI 能调用的全部动作。
 *
 * **为什么不直接调 `scripts/secretary.mjs`**：那个 CLI 的 commands 依赖模块级
 * 的 argv/flags/positional，没法当函数调；spawn 一个子进程又要拼参数字符串，
 * 模型多写一个空格就拼错，而且错了只能从 stderr 里猜。这里直接走 Prisma，
 * 参数由 zod 挡在门口 —— 模型填错类型根本进不来。
 *
 * CLI 仍然留着，那是主人在 Claude Code 那端用的。两边各管各的入口，
 * 共用同一个数据库。
 *
 * **动作的边界就是这张表**。模型只能做这里列出的事，做不了别的 ——
 * 这正是不用通用 coding agent 的理由：它拿到的是一把有限的钥匙，
 * 不是一个 shell。
 */

/** 写完数据要让页面跟着变，否则用户得手动刷新才看得见 */
function refresh(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

const CATEGORIES = ['健康', '保险', '出行', '教育', '财务', '证件', '居家', '其他'] as const;
const VAULT_CATEGORIES = [
  '银行', '学校', '证件', '住址', '公用事业', '税务', '保险', '医疗', '会员', '工作', '其他',
] as const;
const STATUSES = ['todo', 'doing', 'blocked', 'done', 'cancelled'] as const;
const TX_CATEGORIES = [
  'fixed_cost', 'daily_life', 'tools_subscription', 'big_purchase',
  'salary', 'other_income', 'self_transfer', 'pass_through',
  'balance', 'uncategorized',
] as const;

/**
 * 这一轮用户传上来的文件（已经落盘了）。
 *
 * 工具的 execute 只拿得到模型给的参数，拿不到原始附件 —— 所以用闭包把它带
 * 进去。模型读完图给出结构化数据，工具那边顺手把**原件**挂到对应的记录上。
 * 原件必须留：模型读错数字是常态，没有原件就没法回查。
 */
export type ToolContext = {
  incoming: StoredFile[];
  /** 这一轮在哪个对话里。留档、做页面都要记下来，才找得回「当初是怎么说的」 */
  conversationId: string;
};

export function buildAgentTools({ incoming, conversationId }: ToolContext) {
  return {
    // ---------- 任务 ----------

    createTask: tool({
      description:
        '建一条待办。用户说「记一下」「别忘了」「下周要…」这类需要以后跟进的事就用它。' +
        '只是想聊天或问问题不要建。',
      inputSchema: z.object({
        title: z.string().describe('一句话说清要做什么，别写成长段落'),
        detail: z.string().optional().describe('补充说明：背景、具体要求、注意事项'),
        category: z.enum(CATEGORIES).optional().describe('不确定就别填，默认「其他」'),
        priority: z.number().int().min(1).max(3).optional().describe('1=高 2=中 3=低，默认 2'),
        dueDate: z.string().optional().describe('截止日期，格式 2026-09-30。没有明确期限就别填'),
        owner: z.string().optional().describe('谁来办。从系统提示里「家里的人」中选；用户没说是谁的事就别填'),
      }),
      async execute({ title, detail, category, priority, dueDate, owner }) {
        const t = await db.task.create({
          data: {
            title,
            detail: detail ?? null,
            category: category ?? '其他',
            priority: priority ?? 2,
            dueDate: dueDate ? new Date(dueDate) : null,
            owner: owner?.trim() || null,
          },
        });
        refresh('/tasks', '/chat');
        return { ok: true, id: t.id, title: t.title, dueDate: dueDate ?? null, owner: t.owner };
      },
    }),

    listTasks: tool({
      description:
        '查待办。用户问「还有什么没做」「这周要干嘛」「那件事怎么样了」时用。' +
        '默认只看没完成的。',
      inputSchema: z.object({
        status: z.enum(STATUSES).optional().describe('不填 = 所有未完成的（todo/doing/blocked）'),
        category: z.enum(CATEGORIES).optional(),
        keyword: z.string().optional().describe('按标题模糊搜'),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      async execute({ status, category, keyword, limit }) {
        const tasks = await db.task.findMany({
          where: {
            ...(status ? { status } : { status: { in: ['todo', 'doing', 'blocked'] } }),
            ...(category ? { category } : {}),
            ...(keyword ? { title: { contains: keyword } } : {}),
          },
          orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
          take: limit ?? 20,
          select: {
            id: true, title: true, detail: true, status: true,
            category: true, priority: true, dueDate: true, result: true, owner: true,
          },
        });
        return {
          count: tasks.length,
          tasks: tasks.map((t) => ({
            ...t,
            dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
          })),
        };
      },
    }),

    updateTask: tool({
      description:
        '改一条待办：标记完成、改状态、补充处理结果。' +
        '**先用 listTasks 拿到 id**，不要凭印象编 id。',
      inputSchema: z.object({
        id: z.string().describe('任务 id，从 listTasks 的结果里取'),
        status: z.enum(STATUSES).optional(),
        result: z.string().optional().describe('处理结果 / 交付说明'),
        title: z.string().optional(),
        detail: z.string().optional(),
        priority: z.number().int().min(1).max(3).optional(),
        dueDate: z.string().optional().describe('格式 2026-09-30'),
        owner: z.string().optional().describe('改派给谁（「家里的人」里选）；传空字符串 = 取消指派'),
      }),
      async execute({ id, dueDate, owner, ...rest }) {
        const exists = await db.task.findUnique({ where: { id }, select: { id: true } });
        if (!exists) return { ok: false, error: `没有 id 为 ${id} 的任务，先用 listTasks 查一下` };
        const t = await db.task.update({
          where: { id },
          data: {
            ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
            ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
            ...(owner !== undefined ? { owner: owner.trim() || null } : {}),
          },
        });
        refresh('/tasks', `/tasks/${id}`, '/chat');
        return { ok: true, id: t.id, title: t.title, status: t.status };
      },
    }),

    // ---------- 资料库 ----------

    addVaultItem: tool({
      description:
        '存一条要长期记住、以后要查的结构化信息：银行账号、会员号、学号、' +
        'WiFi 密码、证件号。用户说「记住我的…」「以后要查」就用它。' +
        '一次性的聊天内容不要存。',
      inputSchema: z.object({
        title: z.string().describe('这条资料叫什么，例如「招商银行储蓄卡」'),
        category: z.enum(VAULT_CATEGORIES),
        fields: z
          .array(
            z.object({
              label: z.string().describe('字段名，如「账号」「开户行」'),
              value: z.string().describe('字段值'),
              secret: z.boolean().optional().describe('密码类的填 true，页面上会打码'),
            })
          )
          .describe('拆成一条条 label-value，不要把所有信息塞进一个字段'),
        notes: z.string().optional(),
        tags: z.string().optional().describe('逗号分隔'),
        sensitive: z.boolean().optional().describe('整条都敏感（如证件、卡号），列表页默认打码'),
      }),
      async execute({ title, category, fields, notes, tags, sensitive }) {
        const v = await db.vaultItem.create({
          data: {
            title,
            category,
            fields: JSON.stringify(fields),
            notes: notes ?? null,
            tags: tags ?? '',
            sensitive: sensitive ?? false,
          },
        });
        refresh('/vault', '/chat');
        return { ok: true, id: v.id, title: v.title, fieldCount: fields.length };
      },
    }),

    searchVault: tool({
      description:
        '查资料库。用户问「我的卡号是多少」「WiFi 密码」「学号」这类' +
        '「查一个值」的问题时用。',
      inputSchema: z.object({
        keyword: z.string().optional().describe('按名称、备注、标签搜'),
        category: z.enum(VAULT_CATEGORIES).optional(),
      }),
      async execute({ keyword, category }) {
        const items = await db.vaultItem.findMany({
          where: {
            ...(category ? { category } : {}),
            ...(keyword
              ? {
                  OR: [
                    { title: { contains: keyword } },
                    { notes: { contains: keyword } },
                    { tags: { contains: keyword } },
                  ],
                }
              : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        });
        return {
          count: items.length,
          items: items.map((i) => ({
            id: i.id,
            title: i.title,
            category: i.category,
            notes: i.notes,
            fields: JSON.parse(i.fields || '[]'),
          })),
        };
      },
    }),

    // ---------- 留档 ----------

    saveNote: tool({
      description:
        '把一段值得留底的结论、说明或整理结果写进记录页。' +
        '**别滥用** —— 普通对话本身已经存下来了，只有「整理出了一份东西」' +
        '才需要单独留档。',
      inputSchema: z.object({
        content: z.string().describe('要留档的内容，支持 Markdown'),
      }),
      async execute({ content }) {
        const m = await db.message.create({
          data: { role: 'secretary', content, status: 'unread', conversationId },
        });
        refresh('/chat', `/chat/${conversationId}`);
        return { ok: true, id: m.id };
      },
    }),

    // ---------- 传上来的文件 ----------

    saveFile: tool({
      description:
        '把用户这次传上来的文件归档进「文件」页。任何不需要结构化的东西都走它：' +
        '合同、证件照、说明书、截图。**银行账单请用 importBill、体检报告请用 ' +
        'importHealthReport**，那两个会顺手把原件一起存了，别重复存一遍。',
      inputSchema: z.object({
        category: z
          .enum(['账单', '税单', '保单', '医疗', '教育', '合同', '证件', '交付物', '其他'])
          .describe('归到哪一类'),
        note: z.string().optional().describe('这是什么、以后按什么关键词找它'),
      }),
      async execute({ category, note }) {
        if (!incoming.length) {
          return { ok: false, error: '这一轮没有收到文件，让用户先传一个' };
        }
        const saved = [];
        for (const f of incoming) {
          const a = await db.attachment.create({
            data: { ...f, category, note: note ?? null, uploadedBy: 'user' },
          });
          saved.push({ id: a.id, filename: a.filename });
        }
        refresh('/files', '/chat');
        return { ok: true, count: saved.length, files: saved };
      },
    }),

    importBill: tool({
      description:
        '用户传来银行账单（照片/截图/PDF）时用。**你自己看图把每一笔读出来**，' +
        '按参数格式填好 —— 这个工具只负责入库和校验，不会替你解析。' +
        '看不清的笔数写进 warnings，不要编一个数字填上去。',
      inputSchema: z.object({
        bank: z.string().describe('银行名，照抄账单上印的'),
        account: z.string().optional().describe('有多本账才分，只有一本就别填'),
        period: z.string().describe('账期，形如 2026-04'),
        statementDate: z.string().optional().describe('账单日期 2026-05-01'),
        openingTotalCents: z.number().int().optional().describe('期初余额，单位分。有就填，勾稽要用'),
        closingTotalCents: z.number().int().optional().describe('期末余额，单位分'),
        warnings: z.array(z.string()).optional().describe('哪几笔看不清、金额存疑'),
        transactions: z.array(
          z.object({
            date: z.string().describe('2026-04-03'),
            direction: z.enum(['debit', 'credit']).describe('debit 钱出去 / credit 钱进来'),
            amountCents: z.number().int().describe('原币金额，单位分。128.00 元填 12800'),
            currency: z.string().optional().describe('默认 CNY'),
            baseCents: z.number().int().optional().describe('外币才填：折成人民币后的分'),
            counterparty: z.string().optional().describe('对方 / 商户'),
            category: z
              .enum(TX_CATEGORIES)
              .describe('拿不准一律填 uncategorized，页面会单独列出来问，比猜错强'),
            label: z.string().optional().describe('人能看懂的一句话，如「超市采购」'),
            rawText: z.string().optional().describe('账单上那一行的原文，存疑时回查用'),
          })
        ),
      }),
      async execute(p) {
        const key = { bank: p.bank, account: p.account || 'main', period: p.period };
        const rows = p.transactions ?? [];

        // 余额勾稽 —— 模型读错一个数字这里就对不上，是唯一能自动发现
        // 「读错了」的关卡。跟 CLI 的 finance:import 用的是同一套算法。
        const warnings = [...(p.warnings ?? [])];
        const sum = (dir: string) =>
          rows
            .filter((r) => r.direction === dir && r.category !== 'balance')
            .reduce((a, r) => a + (r.baseCents ?? r.amountCents ?? 0), 0);
        const yuan = (c: number) => (c / 100).toFixed(2);
        if (typeof p.openingTotalCents === 'number' && typeof p.closingTotalCents === 'number') {
          const expected = p.openingTotalCents + sum('credit') - sum('debit');
          const diff = p.closingTotalCents - expected;
          if (diff !== 0) {
            warnings.push(
              `余额对不上：期初 ${yuan(p.openingTotalCents)} + 进账 ${yuan(sum('credit'))}` +
                ` − 出账 ${yuan(sum('debit'))} = ${yuan(expected)}，但账单写的期末是` +
                ` ${yuan(p.closingTotalCents)}，差 ${yuan(diff)}。多半是有笔交易读漏了或金额读错了`
            );
          }
        } else {
          warnings.push('账单没给期初/期末余额，这次没做余额勾稽 —— 金额对不对没法自动验');
        }

        const meta = {
          statementDate: p.statementDate ? new Date(p.statementDate) : null,
          openingTotalCents: p.openingTotalCents ?? null,
          closingTotalCents: p.closingTotalCents ?? null,
          note: warnings.length ? warnings.join('；') : null,
        };
        const st = await db.statement.upsert({
          where: { bank_account_period: key },
          create: { ...key, ...meta },
          update: meta,
        });

        // 重导同一个月是覆盖，不是叠加
        const removed = await db.transaction.deleteMany({ where: { statementId: st.id } });
        await db.transaction.createMany({
          data: rows.map((r) => ({
            statementId: st.id,
            date: new Date(r.date),
            direction: r.direction,
            amountCents: r.amountCents,
            currency: r.currency ?? 'CNY',
            account: key.account,
            baseCents: r.baseCents ?? r.amountCents,
            counterparty: r.counterparty ?? null,
            category: r.category,
            label: r.label ?? null,
            rawText: r.rawText ?? null,
          })),
        });

        // 原件挂上去。模型读错数字是常态，没有原件就没法回查。
        // 这次带了原件才动旧的 —— 用户只是发文字来纠正某一笔时，
        // 原件还是上次那份，不能因为这轮没传就把它删了
        if (incoming.length) {
          const old = await db.attachment.findMany({
            where: { statementId: st.id },
            select: { id: true, storedPath: true },
          });
          if (old.length) {
            await db.attachment.deleteMany({ where: { id: { in: old.map((a) => a.id) } } });
            await removeStored(old.map((a) => a.storedPath));
          }
          await db.attachment.createMany({
            data: incoming.map((f) => ({
              ...f, category: '账单', statementId: st.id, uploadedBy: 'user',
              note: `${p.period} 账单原件`,
            })),
          });
        }

        refresh('/finance', `/finance/${p.period}`, '/chat');
        return {
          ok: true,
          period: p.period,
          bank: p.bank,
          imported: rows.length,
          replaced: removed.count,
          attached: incoming.length,
          warnings,
        };
      },
    }),

    importHealthReport: tool({
      description:
        '用户传来体检报告/检验单时用。**你自己看图把指标一项项读出来**，' +
        '正常的也要录 —— 今年正常明年偏高，趋势才看得出来。' +
        '报告上印了箭头或「↑↓」就以它为准填 status，别自己按参考范围算。',
      inputSchema: z.object({
        member: z.string().describe('被检查的人。库里没有会自动建'),
        relation: z.string().optional().describe('新建成员时用：本人/配偶/父亲/母亲/女儿'),
        type: z.string().optional().describe('体检报告 / 检验报告 / 影像报告，默认体检报告'),
        title: z.string().describe('如「2026 年某某医院体检」'),
        checkDate: z.string().describe('体检那天 2026-01-04。**必填**，列表和趋势都按它排'),
        institution: z.string().optional(),
        summary: z
          .string()
          .optional()
          .describe('总检结论与建议，整段 Markdown。这段往往比那堆数字更有价值'),
        notes: z.string().optional().describe('哪几页没录、为什么'),
        metrics: z.array(
          z.object({
            category: z
              .string()
              .optional()
              .describe('肝功能/肾功能/血糖/血脂/血常规/尿常规/影像/一般检查'),
            name: z.string(),
            value: z.string().describe('原样填，「阴性」「未见异常」也是结果'),
            unit: z.string().optional(),
            referenceRange: z.string().optional().describe('参考范围原文，如 "3.9 - 6.1"'),
            status: z.enum(['normal', 'high', 'low', 'abnormal']).optional(),
            note: z.string().optional(),
          })
        ),
      }),
      async execute(p) {
        let member = await db.member.findFirst({ where: { name: p.member } });
        if (!member) {
          member = await db.member.create({
            data: { name: p.member, relation: p.relation ?? '本人' },
          });
        }
        const checkDate = new Date(p.checkDate);
        const type = p.type ?? '体检报告';

        // 同一人 + 同一天 + 同一类型 = 覆盖，不是叠加。读错了重传一次就行
        const existing = await db.healthReport.findFirst({
          where: { memberId: member.id, checkDate, type },
        });

        // 旧报告的原件：这次带了新的就把旧的删掉（连磁盘上的字节），
        // 没带就转挂到新报告下 —— 附件是 SetNull，直接删报告会让它们
        // 变成文件页里一堆没有归属、没人认得出是什么的图
        let carryOver: string[] = [];
        if (existing) {
          const old = await db.attachment.findMany({
            where: { healthReportId: existing.id },
            select: { id: true, storedPath: true },
          });
          if (incoming.length && old.length) {
            await db.attachment.deleteMany({ where: { id: { in: old.map((a) => a.id) } } });
            await removeStored(old.map((a) => a.storedPath));
          } else {
            carryOver = old.map((a) => a.id);
          }
          await db.healthReport.delete({ where: { id: existing.id } });
        }

        const report = await db.healthReport.create({
          data: {
            memberId: member.id,
            type,
            title: p.title,
            checkDate,
            institution: p.institution ?? null,
            summary: p.summary ?? null,
            notes: p.notes ?? null,
          },
        });

        const metrics = (p.metrics ?? []).map((m) => {
          const hasDigit = /[0-9]/.test(m.value);
          const num = Number(String(m.value).replace(/[^0-9.-]/g, ''));
          return {
            reportId: report.id,
            category: m.category ?? '其他',
            name: m.name,
            value: m.value,
            // 「阴性」这类没有数字的不该算出个 NaN 塞进去 —— 趋势图只认 numValue
            numValue: hasDigit && Number.isFinite(num) ? num : null,
            unit: m.unit ?? null,
            referenceRange: m.referenceRange ?? null,
            status: m.status ?? 'normal',
            note: m.note ?? null,
          };
        });
        if (metrics.length) await db.healthMetric.createMany({ data: metrics });

        if (carryOver.length) {
          await db.attachment.updateMany({
            where: { id: { in: carryOver } },
            data: { healthReportId: report.id },
          });
        }
        if (incoming.length) {
          await db.attachment.createMany({
            data: incoming.map((f) => ({
              ...f, category: '医疗', healthReportId: report.id, uploadedBy: 'user',
              note: `${p.title} 原件`,
            })),
          });
        }

        refresh('/health', `/health/${report.id}`, '/chat');
        const abnormal = metrics.filter((m) => m.status !== 'normal');
        return {
          ok: true,
          id: report.id,
          member: member.name,
          metrics: metrics.length,
          abnormal: abnormal.length,
          abnormalNames: abnormal.slice(0, 10).map((m) => m.name),
          replaced: !!existing,
          attached: incoming.length,
        };
      },
    }),

    // ---------- 只读查询（财务 / 健康 / 保单）：见 data-tools.ts ----------
    ...buildDataTools(),

    // ---------- AI 生成的页面：见 page-tools.ts ----------
    ...buildPageTools(conversationId),
  } as const;
}

export type AgentTools = ReturnType<typeof buildAgentTools>;
export type AgentToolName = keyof AgentTools;
