import { cache } from 'react';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { isLocale, makeT, type Locale, type T } from './core';
import { EN } from './en';

/**
 * 服务端取当前界面语言。
 *
 * 存在 Setting 表（key = locale），**不是 cookie** —— 桌面端开了「用手机访问」后，
 * 手机和电脑看的是同一份数据，语言也该是同一个，不该各设各的。
 *
 * 还没设过：看浏览器的 Accept-Language（Electron 发的是系统语言），
 * 英文系统第一次打开就是英文界面，不用先在一堆中文里找设置。
 */
const KEY = 'locale';

export const getLocale = cache(async (): Promise<Locale> => {
  const row = await db.setting.findUnique({ where: { key: KEY } }).catch(() => null);
  if (row && isLocale(row.value)) return row.value;
  const accept = (await headers()).get('accept-language') ?? '';
  const first = accept.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('zh') || !first ? 'zh' : 'en';
});

export async function setLocale(locale: Locale) {
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: locale }, update: { value: locale } });
}

/** 服务端组件 / server action 里用：`const t = await getT();` */
export async function getT(): Promise<T> {
  return makeT((await getLocale()) === 'en' ? EN : null);
}

/** 给客户端 Provider 的词典：中文界面不下发（省 40KB） */
export async function clientDict() {
  return (await getLocale()) === 'en' ? EN : null;
}
