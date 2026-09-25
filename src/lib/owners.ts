import { db } from './db';

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
const DEFAULT_OWNERS = ['我'];
/** 「待定」是 OwnerSelect 里 owner = null 的显示名，不能再当一个人名 */
const RESERVED = ['待定', '未指派'];
const MAX = 12;

export async function getOwners(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_OWNERS;
  try {
    const v = JSON.parse(row.value);
    if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) return v;
  } catch {}
  return DEFAULT_OWNERS;
}

/** 逗号（中英文）、顿号、换行都当分隔符。空格不算 —— 英文名里有空格 */
export function parseOwners(raw: string): { ok: true; owners: string[] } | { ok: false; error: string } {
  const owners = [...new Set(raw.split(/[,，、\n]+/).map((s) => s.trim()).filter(Boolean))];
  if (!owners.length) return { ok: false, error: '至少留一个人' };
  if (owners.length > MAX) return { ok: false, error: `最多 ${MAX} 个人` };
  const bad = owners.find((n) => RESERVED.includes(n));
  if (bad) return { ok: false, error: `「${bad}」是没人认领时的显示，换个名字` };
  const long = owners.find((n) => n.length > 12);
  if (long) return { ok: false, error: `「${long}」太长了，写个称呼就行` };
  return { ok: true, owners };
}

export async function setOwners(owners: string[]) {
  const value = JSON.stringify(owners);
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}
