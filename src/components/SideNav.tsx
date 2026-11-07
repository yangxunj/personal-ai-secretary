'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SideNavView from './navigation/shared/SideNavView';
import ThemeToggle from './ThemeToggle';
import { SearchIcon, SettingsIcon } from './PageHeader';
import { useT } from '@/lib/i18n/client';

/**
 * 宽屏（lg 及以上）的左侧导航。窄屏上不渲染，那边用 `BottomNav`。
 *
 * 为什么不是一个组件用断点切换内部结构：底栏是横向七格、侧栏是纵向列表 +
 * 文字标签，DOM 结构差得太远，硬糅在一起两边都别扭。共用的只有 TABS 和图标，
 * 那两样已经抽到 `nav-tabs.tsx` 了 —— **加一个入口只要改那一个文件**。
 *
 * 常驻展开（图标 + 文字）而不是只留图标条：桌面上不缺这 200px，而带文字的
 * 导航对第一次打开的人友好得多 —— 七个图标里哪个是"专题"，猜不出来。
 */
export default function SideNav({ badge, collections = [] }: { badge?: number; collections?: { id: string; title: string }[] }) {
  const pathname = usePathname();
  const t = useT();
  return <SideNavView pathname={pathname} badge={badge} t={t}
    renderItem={({ href, className, style, children }) => <Link key={href} href={href} className={className} style={style}>{children}</Link>}
    collections={collections.map(collection => <Link key={collection.id} href={'/collections/' + collection.id}
      className={`block rounded-xl py-2 pl-11 pr-3 text-[13px] break-words ${pathname === '/collections/' + collection.id || pathname.startsWith('/collections/' + collection.id + '/') ? 'bg-brand-500/10 text-brand-500' : 'muted'}`}>
      {collection.title}</Link>)}
    trailing={<div className="shrink-0 border-t px-2 py-3 space-y-0.5" style={{ borderColor: 'var(--border)' }}>
        {[
          { href: '/search', label: t('搜索'), icon: <SearchIcon className="h-5 w-5 shrink-0" /> },
          { href: '/settings', label: t('设置'), icon: <SettingsIcon className="h-5 w-5 shrink-0" /> },
        ].map((x) => {
          const active = pathname === x.href || pathname.startsWith(x.href + '/');
          return (
            <Link
              key={x.href}
              href={x.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition ${
                active ? 'bg-brand-500/10' : 'hover:bg-brand-500/5'
              }`}
              style={{ color: active ? 'var(--color-brand-500)' : 'var(--muted)' }}
            >
              {x.icon}
              <span className="font-medium">{x.label}</span>
            </Link>
          );
        })}
        <ThemeToggle withLabel />
      </div>} />;
}
