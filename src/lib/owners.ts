import { db } from './db';
import { getT } from './i18n/server';
export { parseOwners } from './tasks/owners-policy';

/**
 * 家里的人 —— 任务能派给谁、留言能以谁的名义说。存在 Setting 表里，设置页改。
 *
 * ★ 原来是 `.env` 的 NEXT_PUBLIC_OWNERS。NEXT_PUBLIC_ 是**打包时写死进页面代码**的，
 *   绿色版里固定成了开发者这边填的「本人,妻子」，拿到的人改不了，平台里也没地方改。
 *   跟模型 key 是同一个道理：交给别人用的东西，不能要他去改配置文件。
 *
 * 这只是**下拉框里的候选人**。库里 task.owner 是自由文本，这里删掉一个名字，
 * 派给他的任务照样在，筛选条的人名也照样取自库里真实出现过的值。
 */
const KEY = 'owners';
/**
 * 没设过时的默认名单，跟着界面语言走。只是默认值 —— 一旦在设置页存过，
 * 库里是什么就是什么，换界面语言不会去改名字（那是人家起的称呼）。
 */
const defaultOwners = async () => {
  const t = await getT();
  return [t('我')];
};
export async function getOwners(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  if (!row) return defaultOwners();
  try {
    const v = JSON.parse(row.value);
    if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) return v;
  } catch {}
  return defaultOwners();
}

export async function setOwners(owners: string[]) {
  const value = JSON.stringify(owners);
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}
