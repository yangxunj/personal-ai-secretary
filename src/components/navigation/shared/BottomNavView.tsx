import type { CSSProperties, ReactNode } from 'react';
import { TABS, NavIcon } from '../../nav-tabs';

type Item = { href: string; label: string; icon: string; active: boolean; className: string; style: CSSProperties; children: ReactNode };
export default function BottomNavView({ pathname, badge, t, renderItem, tabs: configuredTabs }: {
  pathname: string; badge?: number; t: (text: string) => string; renderItem: (item: Item) => ReactNode;
  tabs?: readonly { href: string; label: string; icon: string }[];
}) {
  const tabs = configuredTabs ?? TABS.filter(tab => !('wideOnly' in tab && tab.wideOnly)).slice(0, 6);
  const items = [...tabs, { href: '/more', label: '更多', icon: 'page' }]; // i18n-ignore: translated below
  return <nav aria-label={t('主导航')} className="shared-bottom-nav lg:hidden fixed bottom-0 inset-x-0 z-40 border-t surface pb-safe" style={{ borderColor: 'var(--border)' }}>
    <div className="mx-auto max-w-2xl grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map(tab => {
        const active = tab.href === '/more'
          ? ['/more', '/files', '/pages', '/mail', '/collections'].some(path => pathname === path || pathname.startsWith(path + '/'))
          : pathname === tab.href || pathname.startsWith(tab.href + '/');
        const children = <><span className="relative"><NavIcon name={tab.icon} className="h-[22px] w-[22px]" />
          {tab.href === '/tasks' && !!badge && badge > 0 && <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center">{badge}</span>}</span>
          <span className="text-[10px] font-medium">{t(tab.label)}</span></>;
        return renderItem({ ...tab, active, className: 'flex flex-col items-center gap-1 py-2.5 transition',
          style: { color: active ? 'var(--color-brand-500)' : 'var(--muted)' }, children });
      })}
    </div>
  </nav>;
}
