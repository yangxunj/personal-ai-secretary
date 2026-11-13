import type { ReactNode } from 'react';
import { TABS, NavIcon } from '../../nav-tabs';

export default function MoreNavigationView({ t, renderItem }: {
  t: (text: string) => string;
  renderItem: (item: { href: string; label: string; children: ReactNode }) => ReactNode;
}) {
  return <>{TABS.filter(tab => ['/files', '/pages', '/mail', '/collections', '/ppt'].includes(tab.href)).map(tab =>
    renderItem({ href: tab.href, label: tab.label, children: <><NavIcon name={tab.icon} className="h-5 w-5" />{t(tab.label)}</> }))}</>;
}
