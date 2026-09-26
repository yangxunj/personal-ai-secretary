import { db } from './db';
import { getT } from './i18n/server';
import { makeT, type T } from './i18n/core';

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
/**
 * 「待定」「未指派」是 owner = null 的显示名，不能再当一个人名。
 * 两种界面语言的都拦 —— 换了语言，库里那个名字照样会跟显示名撞上。
 */
const RESERVED = ['待定', '未指派', 'unassigned']; // i18n-ignore：保留名，中英都得拦
const MAX = 12;

export async function getOwners(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  if (!row) return defaultOwners();
  try {
    const v = JSON.parse(row.value);
    if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) return v;
  } catch {}
  return defaultOwners();
}

/**
 * 逗号（中英文）、顿号、换行都当分隔符。空格不算 —— 英文名里有空格。
 * t 是报错用的翻译函数，server action 里传 `await getT()`。
 */
export function parseOwners(
  raw: string,
  t: T = makeT(null),
): { ok: true; owners: string[] } | { ok: false; error: string } {
  const owners = [...new Set(raw.split(/[,，、\n]+/).map((s) => s.trim()).filter(Boolean))];
  if (!owners.length) return { ok: false, error: t('至少留一个人') };
  if (owners.length > MAX) return { ok: false, error: t('最多 {n} 个人', { n: MAX }) };
  const bad = owners.find((n) => RESERVED.includes(n.toLowerCase()));
  if (bad) return { ok: false, error: t('「{name}」是没人认领时的显示，换个名字', { name: bad }) };
  const long = owners.find((n) => n.length > 12);
  if (long) return { ok: false, error: t('「{name}」太长了，写个称呼就行', { name: long }) };
  return { ok: true, owners };
}

export async function setOwners(owners: string[]) {
  const value = JSON.stringify(owners);
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}
