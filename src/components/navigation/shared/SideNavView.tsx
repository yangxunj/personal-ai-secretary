import type { CSSProperties, ReactNode } from 'react';
import { TABS, NavIcon } from '../../nav-tabs';

type Item = { href: string; label: string; active: boolean; className: string; style: CSSProperties; children: ReactNode };
export default function SideNavView({ pathname, badge, t, renderItem, collections, trailing, hiddenPaths = [] }: {
  pathname: string; badge?: number; t: (text: string) => string;
  renderItem: (item: Item) => ReactNode; collections?: ReactNode; trailing?: ReactNode;
  hiddenPaths?: readonly string[];
}) {
  return <nav aria-label={t('主导航')} className="shared-side-nav hidden lg:flex fixed inset-y-0 left-0 z-40 w-56 flex-col border-r surface" style={{ borderColor: 'var(--border)' }}>
    <div className="px-5 h-14 flex items-center shrink-0"><span className="font-semibold tracking-tight">{t('家庭管家')}</span></div>
    <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
      {TABS.filter(tab => !hiddenPaths.includes(tab.href)).map(tab => {
        const active = pathname === tab.href || tab.href !== '/collections' && pathname.startsWith(tab.href + '/');
        const children = <><NavIcon name={tab.icon} className="h-[20px] w-[20px] shrink-0" /><span className="font-medium">{t(tab.label)}</span>
          {tab.href === '/tasks' && !!badge && badge > 0 && <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] leading-5 text-center">{badge}</span>}</>;
        return renderItem({ href: tab.href, label: tab.label, active,
          className: `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition ${active ? 'bg-brand-500/10' : ''}`,
          style: { color: active ? 'var(--color-brand-500)' : 'var(--muted)' }, children });
      })}
      {collections}
    </div>
    {trailing}
  </nav>;
}
