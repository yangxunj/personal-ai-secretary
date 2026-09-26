'use client';

import { createContext, useContext, useMemo } from 'react';
import { makeT, type Dict, type Locale, type T } from './core';

const Ctx = createContext<{ locale: Locale; t: T }>({ locale: 'zh', t: makeT(null) });

/** 根 layout 里包一层。dict 由服务端给（中文界面是 null） */
export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dict | null; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(dict) }), [locale, dict]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 客户端组件里用：`const t = useT();` */
export function useT(): T {
  return useContext(Ctx).t;
}

export function useLocale(): Locale {
  return useContext(Ctx).locale;
}
