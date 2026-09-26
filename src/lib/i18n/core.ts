/**
 * 界面多语言 —— 纯函数部分，服务端和客户端都能用。
 *
 * **中文原文就是 key**（gettext 的路子）：`t('新建任务')`。
 * - 中文界面：原样返回，不查表。
 * - 英文界面：查 `en/` 里的词典，查不到退回中文原文 —— 漏翻的只是显示中文，不会炸。
 *
 * 为什么不用 'tasks.new' 这种 key：这是给一个已经写满中文的项目补多语言，
 * 中文当 key 改动最小，读代码时也一眼知道这里显示的是什么。
 * 漏翻靠 `node scripts/i18n-check.mjs` 兜：它把所有 t('…') 的 key 抽出来，
 * 跟英文词典对账。
 *
 * 插值：`t('{n} 条', { n: 3 })`。英文的单复数写在词典里：
 * `'{n} 条': '{n} {n|item|items}'` —— `{变量|单数|复数}`，变量等于 1 取单数。
 */
export type Locale = 'zh' | 'en';
export const LOCALES: readonly Locale[] = ['zh', 'en'];
export const LOCALE_NAMES: Record<Locale, string> = { zh: '中文', en: 'English' };

export type Dict = Record<string, string>;
export type Vars = Record<string, string | number>;
export type T = (key: string, vars?: Vars) => string;

export function isLocale(v: unknown): v is Locale {
  return v === 'zh' || v === 'en';
}

export function translate(dict: Dict | null, key: string, vars?: Vars): string {
  let s = dict?.[key] ?? key;
  if (!vars) return s;
  s = s.replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_, k, one, many) => (Number(vars[k]) === 1 ? one : many));
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function makeT(dict: Dict | null): T {
  return (key, vars) => translate(dict, key, vars);
}

/** Intl 用的 BCP 47 标签 */
export function intlTag(locale: Locale) {
  return locale === 'en' ? 'en-US' : 'zh-CN';
}
