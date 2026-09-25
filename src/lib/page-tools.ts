import { tool } from 'ai';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { PAGE_KINDS, pageWarnings, restoreVersion, savePage } from '@/lib/pages';

/**
 * AI 生成页面的四个动作。怎么展示、为什么要沙箱，见 lib/pages.ts。
 *
 * savePage 的描述就是「怎么写一个在这里能跑的页面」的全部规范 —— 模型只看得见
 * 工具描述，写在别处它不知道。里面好几条是 livepage 实测撞出来的（手机没有方向键、
 * alert 被吞、游戏结束不能重来），改的时候别弄丢。
 */

function refresh(id?: string) {
  revalidatePath('/pages');
  if (id) revalidatePath(`/pages/${id}`);
}

const HTML_GUIDE = `
写一个**完整、独立的单文件 HTML**（<!doctype html> 开头，CSS 和 JS 都内联）。

它跑在沙箱里，下面几条是硬限制，不是建议：
- **不能联网**：CDN 上的图表库、网络字体、外链图片一律加载不出来，fetch 也发不出去。
  图表用内联 <svg> 或 <canvas> 自己画；字体用 system-ui。
- **数据直接写进 HTML**。先用 queryFinance / queryHealth / queryPolicies / listTasks
  查到真实数据，再把数字写进页面。**绝不编数据**；没查到就在页面上写明「暂无数据」。
  数据快照类页面要在显眼处写「数据截至 YYYY-MM-DD」，日期取查询结果里的 dataAsOf / 最新一条的日期，别自己编。
- alert() 能用（显示成不阻塞的提示条）；confirm() / prompt() 不行，要确认或输入就自己画按钮和 <input>。
- localStorage 只在这次打开期间有效，关掉就没了。别承诺「会记住最高分」。

**手机优先** —— 用户很可能在手机上看：
- 必须有 <meta name="viewport" content="width=device-width, initial-scale=1">
- 宽度用 max-width:100% / 百分比，别写死几百像素宽
- 游戏和小工具**必须一根手指就能玩全**：别只绑 keydown（手机没有键盘，更没有方向键），
  自己画一副方向键或支持滑动（touchstart / touchend），点击目标至少 44px 见方
- 游戏结束要能「再来一局」，别 alert 一句就停住

**深浅两种主题都要好看**：用 CSS 变量 + @media (prefers-color-scheme: dark) 写两套颜色，
页面外面的平台切到深色时，这里会跟着收到 dark。

好看一点：留白充足、字号层次清楚、圆角卡片、克制的配色。数字用 tabular-nums 对齐。
`;

export function buildPageTools(conversationId?: string) {
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
      description: '取一个页面现在的完整 HTML。**要改已有页面，先取回来在它的基础上改**，别凭印象从头重写。',
      inputSchema: z.object({ id: z.string() }),
      async execute({ id }) {
        const p = await db.page.findUnique({ where: { id } });
        if (!p) return { ok: false, error: `没有 id 为 ${id} 的页面，先用 listPages 查一下` };
        return { ok: true, id: p.id, title: p.title, kind: p.kind, request: p.request, html: p.html };
      },
    }),

    savePage: tool({
      description:
        '做一个网页，存进「页面」栏目 —— 用户说「做个页面/图表/报告/看板」「做个小游戏/小工具」时用。' +
        '不带 id 是新建；带 id 是整页替换（旧的自动存成历史版本，能退回）。\n' +
        HTML_GUIDE,
      inputSchema: z.object({
        id: z.string().optional().describe('改已有页面时填它的 id；新建不填'),
        title: z.string().describe('页面标题，简短，如「2026 年支出分析」「贪吃蛇」'),
        summary: z.string().optional().describe('一句话说明，显示在页面墙卡片上'),
        request: z
          .string()
          .optional()
          .describe('新建时填：用户的原始要求，写完整（含时间范围、要看什么）。以后「按最新数据重新生成」就是把这句话再交给你'),
        kind: z
          .enum(Object.keys(PAGE_KINDS) as [keyof typeof PAGE_KINDS, ...(keyof typeof PAGE_KINDS)[]])
          .describe('snapshot = 用查来的数据做的报告/图表；app = 游戏、计算器这类自带玩法、不依赖数据的'),
        html: z.string().describe('完整 HTML 文档'),
      }),
      async execute(p) {
        const r = await savePage({ ...p, conversationId });
        if (!r.ok) return r;
        refresh(r.id);
        const warnings = pageWarnings(p.html);
        return {
          ok: true,
          id: r.id,
          created: r.created,
          url: `/pages/${r.id}`,
          ...(warnings.length ? { warnings } : {}),
          hint: `回复里附上链接 [打开页面](/pages/${r.id})。有 warnings 就先改好再告诉用户。`,
        };
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
