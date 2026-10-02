import { tool } from 'ai';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { PAGE_KINDS, pageWarnings, restoreVersion, savePage } from '@/lib/pages';
import { PAGE_TYPES } from '@/lib/page-design';
import { buildPageHtml, type BuildProgress, type PageBuilder } from '@/lib/page-builder';
import { declaredSchema, dumpForModel, setData, shapeSummary } from '@/lib/page-data';

/**
 * AI 生成页面的几个动作。怎么展示、为什么要沙箱，见 lib/pages.ts。
 *
 * 页面本身不是对话里的模型写的：它调 buildPage 交一份需求，由 lib/page-builder.ts
 * 另起一次推理拉满的调用来写。所以「怎么写一个在这里能跑的页面」的规范在那边，
 * 这里只告诉对话模型**需求该怎么交**。
 *
 * 页面自带存储（pageStore）的数据，AI 用 getPageData / setPageData 读写 —— 页面里记的读书记录，
 * 用户在对话里问「今年读了几本」时要答得上来。
 */

function refresh(id?: string) {
  revalidatePath('/pages');
  if (id) revalidatePath(`/pages/${id}`);
}

const KIND_ENUM = Object.keys(PAGE_KINDS) as [keyof typeof PAGE_KINDS, ...(keyof typeof PAGE_KINDS)[]];

export function buildPageTools({ conversationId, builder }: { conversationId?: string; builder?: PageBuilder }) {
  return {
    listPages: tool({
      description: '列出已经做过的页面。用户说「改一下那个页面」「上次那个图表」时，先用它找到 id。',
      inputSchema: z.object({
        keyword: z.string().optional().describe('按标题、说明搜'),
      }),
      async execute({ keyword }) {
        const pages = await db.page.findMany({
          where: keyword ? { OR: [{ title: { contains: keyword } }, { summary: { contains: keyword } }] } : undefined,
          orderBy: { updatedAt: 'desc' },
          take: 30,
          select: { id: true, title: true, summary: true, kind: true, updatedAt: true, _count: { select: { versions: true } } },
        });
        return {
          count: pages.length,
          pages: pages.map((p) => ({
            id: p.id,
            title: p.title,
            summary: p.summary,
            kind: p.kind,
            updatedAt: p.updatedAt.toISOString().slice(0, 16).replace('T', ' '),
            oldVersions: p._count.versions,
            url: `/pages/${p.id}`,
          })),
        };
      },
    }),

    getPage: tool({
      description:
        '取一个页面现在的完整 HTML，看它现在是什么样。**改页面不用先取**：buildPage 带上 id，' +
        '写页面的模型会自己拿到原来的 HTML 在上面改。',
      inputSchema: z.object({ id: z.string() }),
      async execute({ id }) {
        const p = await db.page.findUnique({ where: { id } });
        if (!p) return { ok: false, error: `没有 id 为 ${id} 的页面，先用 listPages 查一下` };
        return { ok: true, id: p.id, title: p.title, kind: p.kind, request: p.request, html: p.html };
      },
    }),

    buildPage: tool({
      description:
        '做一个网页，存进「页面」栏目 —— 用户说「做个页面/图表/报告/看板」「做个小游戏/小工具」' +
        '「做个读书记录/打卡表/清单」时用。不带 id 是新建；带 id 是在原页面基础上改（旧的自动存成历史版本，能退回）。\n\n' +
        '页面由**专门的设计模型**来写（推理拉满，要一两分钟），它看不到这段对话、看不到图片、查不了数据库，' +
        '只看得到你给的 brief 和 data。所以：\n' +
        '- brief 写清楚：给谁用、用来干什么、要有哪些内容和功能、想要的风格。用户原话里的要求一条都别丢。' +
        '改页面时写清「改什么、别动什么」。\n' +
        '- 要用真实数据的（报告、图表），**先用查询工具查好**，原样放进 data；别让它编。\n' +
        '- 学习类（作业题、错题、知识点）：**先在回复里写出题目和答案、自己验算**，再把题目原文、正确答案、' +
        '解题步骤、知识点、年级写进 brief。\n' +
        '- 要记东西的页面（读书记录、打卡、记账）会用页面自带的存储，不用你管；以后用 getPageData 能读到里面的内容。',
      inputSchema: z.object({
        id: z.string().optional().describe('改已有页面时填它的 id；新建不填'),
        title: z.string().describe('页面标题，简短，如「2026 年支出分析」「贪吃蛇」「读书记录」'),
        summary: z.string().optional().describe('一句话说明，显示在页面墙卡片上'),
        request: z
          .string()
          .optional()
          .describe('新建时填：用户的原始要求，写完整（含时间范围、要看什么）。以后「按最新数据重新生成」就是把这句话再交给你'),
        kind: z.enum(KIND_ENUM).describe('snapshot = 用查来的数据做的报告/图表；app = 游戏、工具、记录本这类自带玩法的'),
        type: z
          .enum(PAGE_TYPES)
          .describe(
            'game = 游戏；learning = 用作业题、错题、知识点做的练习游戏；' +
              'tool = 计算器、倒计时、读书记录、打卡表这类小工具和记录本；report = 用查来的数据做的报告/图表',
          ),
        brief: z.string().describe('给设计模型的完整需求，见上面的说明。宁可写长，别让它猜'),
        data: z.string().optional().describe('要写进页面的真实数据（JSON 或表格文字）。报告类必填，游戏和工具一般不用'),
      }),
      async *execute(p, { abortSignal }) {
        if (!builder) {
          yield { ok: false as const, error: '这次对话没有配置写页面的模型' };
          return;
        }
        const old = p.id ? await db.page.findUnique({ where: { id: p.id }, select: { html: true } }) : null;
        if (p.id && !old) {
          yield { ok: false as const, error: `没有 id 为 ${p.id} 的页面，先用 listPages 查一下` };
          return;
        }
        const stored = p.id ? await shapeSummary(p.id) : [];

        const gen = buildPageHtml(builder, {
          type: p.type,
          title: p.title,
          brief: p.brief,
          data: p.data,
          existing: old?.html,
          stored,
          abortSignal,
        });
        let step = await gen.next();
        while (!step.done) {
          yield { progress: step.value satisfies BuildProgress };
          step = await gen.next();
        }
        const built = step.value;
        if (!built.ok) {
          yield built;
          return;
        }

        const r = await savePage({
          id: p.id,
          title: p.title,
          summary: p.summary,
          request: p.request,
          kind: p.kind,
          html: built.html,
          conversationId,
        });
        if (!r.ok) {
          yield r;
          return;
        }
        refresh(r.id);
        const warnings = pageWarnings(built.html);
        yield {
          ok: true as const,
          id: r.id,
          created: r.created,
          url: `/pages/${r.id}`,
          ...(warnings.length ? { warnings } : {}),
          hint:
            `回复里附上链接 [打开页面](/pages/${r.id})，一两句说清页面上有什么、怎么用。` +
            (warnings.length ? '有 warnings 的话，再调一次 buildPage（带 id）让它改掉。' : ''),
        };
      },
    }),

    getPageData: tool({
      description:
        '读一个页面自带存储里的数据（用户在页面里记的东西：读书记录、打卡、清单……）。' +
        '用户问「我今年读了几本书」「上周打卡了几天」这类问题时，先 listPages 找到页面，再用它读，**别凭印象答**。',
      inputSchema: z.object({ id: z.string().describe('页面 id') }),
      async execute({ id }) {
        const page = await db.page.findUnique({ where: { id }, select: { title: true, html: true } });
        if (!page) return { ok: false, error: `没有 id 为 ${id} 的页面，先用 listPages 查一下` };
        const { data, truncated } = await dumpForModel(id);
        const schema = declaredSchema(page.html);
        const empty = !Object.keys(data).length && !truncated.length;
        return {
          ok: true,
          title: page.title,
          // 页面声明的格式：往里写东西时照它的 key 和字段名来
          ...(schema ? { schema } : {}),
          data,
          ...(truncated.length ? { truncated, note: '这几个 key 太大没放进来' } : {}),
          ...(empty
            ? {
                note: schema
                  ? '这个页面里还没有存任何数据。要写的话照 schema 的 key 和 example 的字段格式写'
                  : '这个页面里还没有存任何数据，也没声明格式。要写的话先 getPage 看代码里 pageStore 用的 key 和字段名，别猜',
              }
            : {}),
        };
      },
    }),

    setPageData: tool({
      description:
        '往页面自带存储里写一个 key（整份覆盖）。用户在对话里说「读书记录里加一本《xx》」「把那条打卡删了」时用。\n' +
        '**先 getPageData 取回原来的值和 schema，在它基础上加/改，再整份写回**，字段名和格式跟 schema、原来的条目保持一致 —— ' +
        '页面是按那个格式读的，写错了页面上就显示不出来。',
      inputSchema: z.object({
        id: z.string().describe('页面 id'),
        key: z.string().describe('要写的 key，用页面里已有的那个'),
        valueJson: z.string().describe('新的完整值，JSON 文本'),
      }),
      async execute({ id, key, valueJson }) {
        let value: unknown;
        try {
          value = JSON.parse(valueJson);
        } catch {
          return { ok: false, error: 'valueJson 不是合法的 JSON' };
        }
        const r = await setData(id, key, value);
        return r.ok ? { ok: true, hint: `页面下次打开时就能看到。链接：/pages/${id}` } : r;
      },
    }),

    restorePageVersion: tool({
      description:
        '把页面退回上一版（用户说「改坏了」「还是原来那个好」时用）。' +
        '当前这版会存成历史，所以再调一次就是切回来。',
      inputSchema: z.object({ id: z.string() }),
      async execute({ id }) {
        const r = await restoreVersion(id);
        if (r.ok) refresh(id);
        return r.ok ? { ...r, url: `/pages/${id}` } : r;
      },
    }),
  } as const;
}
