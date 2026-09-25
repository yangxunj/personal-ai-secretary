import { db } from '@/lib/db';
import { SAMPLE_PAGES } from './sample-pages.data';

/**
 * 装好就带的示例页面。
 *
 * 绿色版 / 安装版是空库，「页面」栏目空着的时候，没人想得到「说一句话就能
 * 做个小游戏」。放几个现成的，比什么说明都直观。
 *
 * 几条规矩：
 * - **只放自带玩法的小程序**（游戏、练习、小工具），不放数据快照 —— 空库里
 *   没数据可画，用编的数据做图表，用户会当成自己的账。
 * - **是我们自己的模型真实生成的**，只修过明显的毛病。手写得比模型做得精致，
 *   用户照着说却做不出来，反而失望。
 * - **删了不再冒出来**。Setting 里记着「哪些 key 放过」，只补没放过的 ——
 *   以后加新示例，老用户也能补上新的那几个，但删掉的不会回来。
 * - 用户在对话里改过的，`sample` 就清掉（lib/pages.ts 的 savePage），算他自己的了。
 *
 * 源文件在 samples/pages/，改完跑 `node scripts/build-samples.mjs`。
 */

export type SamplePage = {
  key: string;
  title: string;
  summary: string;
  /** 当初那句要求 —— 写成用户会说的样子，详情页上就是「这样说就能做出来」 */
  request: string;
  /** 游戏 / 教育 / 生活 / 工作 */
  category: string;
  kind: string;
  html: string;
};

/** 页面墙上类别的顺序 */
export const SAMPLE_CATEGORIES = ['游戏', '教育', '生活', '工作'];

const MARK = 'seeded.samplePages';

export async function ensureSamplePages(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: MARK } });
  const seeded = new Set<string>(row ? JSON.parse(row.value) : []);
  const todo = SAMPLE_PAGES.filter((p) => !seeded.has(p.key));
  if (!todo.length) return [];

  // 创建时间按 manifest 顺序错开一秒，页面墙按它排
  const base = Date.now();
  await db.$transaction([
    ...todo.map((p, i) =>
      db.page.create({
        data: {
          title: p.title,
          summary: p.summary,
          request: p.request,
          kind: p.kind,
          html: p.html,
          sample: p.category,
          createdAt: new Date(base + i * 1000),
          updatedAt: new Date(base + i * 1000),
        },
      }),
    ),
    db.setting.upsert({
      where: { key: MARK },
      create: { key: MARK, value: JSON.stringify([...seeded, ...todo.map((p) => p.key)]) },
      update: { value: JSON.stringify([...seeded, ...todo.map((p) => p.key)]) },
    }),
  ]);
  return todo.map((p) => p.title);
}
