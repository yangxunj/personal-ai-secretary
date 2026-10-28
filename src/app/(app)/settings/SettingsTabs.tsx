'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';

type Tab = 'ai' | 'general' | 'connections';
const tabs: Tab[] = ['ai', 'general', 'connections'];

export default function SettingsTabs({ initialTab, navigationKey, ai, general, connections }: {
  initialTab: Tab;
  navigationKey: string;
  ai: ReactNode;
  general: ReactNode;
  connections: ReactNode;
}) {
  const t = useT();
  const [selected, setSelected] = useState<Tab>(initialTab);
  const buttons = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const labels = { ai: t('AI 设置'), general: t('通用 · General'), connections: t('连接与安全') };

  useEffect(() => {
    function restore() {
      const hash = window.location.hash;
      const sectionTab = ['#language', '#members'].includes(hash) ? 'general'
        : ['#voice', '#speech', '#realtime'].includes(hash) ? 'ai' : null;
      const queryTab = new URLSearchParams(window.location.search).get('tab');
      setSelected(sectionTab ?? (tabs.includes(queryTab as Tab) ? queryTab as Tab : initialTab));
      if (sectionTab) requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView());
    }
    restore();
    window.addEventListener('hashchange', restore);
    window.addEventListener('popstate', restore);
    return () => {
      window.removeEventListener('hashchange', restore);
      window.removeEventListener('popstate', restore);
    };
  }, [initialTab, navigationKey]);

  function select(tab: Tab) {
    setSelected(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    url.hash = '';
    window.history.replaceState(window.history.state, '', url);
  }

  return <>
    <div role="tablist" aria-label={t('设置分类')} className="grid grid-cols-3 gap-1 rounded-2xl border p-1 surface mb-4" style={{ borderColor: 'var(--border)' }}>
      {tabs.map((tab, index) => <button key={tab} type="button" role="tab"
        ref={el => { buttons.current[tab] = el; }}
        id={`settings-tab-${tab}`} aria-controls={`settings-panel-${tab}`}
        aria-selected={selected === tab} tabIndex={selected === tab ? 0 : -1}
        onClick={() => select(tab)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
            : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length]
            : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : null;
          if (next) { event.preventDefault(); select(next); buttons.current[next]?.focus(); }
        }}
        className={`min-w-0 rounded-xl px-1 py-2.5 text-[13px] sm:text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${selected === tab ? 'bg-brand-500/10 text-brand-500 font-semibold' : 'muted hover:bg-brand-500/5'}`}
      >{labels[tab]}</button>)}
    </div>
    {tabs.map(tab => <div key={tab} id={`settings-panel-${tab}`} role="tabpanel"
      aria-labelledby={`settings-tab-${tab}`} hidden={selected !== tab}
      className={selected === tab ? 'space-y-4' : 'hidden'}>
      {/* Keep every panel mounted so tab changes preserve unsaved form values. */}
      {{ ai, general, connections }[tab]}
    </div>)}
  </>;
}
