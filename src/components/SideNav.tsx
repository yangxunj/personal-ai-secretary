'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TABS, NavIcon } from './nav-tabs';
import ThemeToggle from './ThemeToggle';
import { SearchIcon, SettingsIcon } from './PageHeader';

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
export default function SideNav({ badge }: { badge?: number }) {
  const pathname = usePathname();
  return (
    <nav
      className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-56 flex-col border-r surface"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="px-5 h-14 flex items-center shrink-0">
        <span className="font-semibold tracking-tight">家庭管家</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(t.href + '/');
          return (
            <Link
              key={t.href}
              href={t.href}
              // 选中态在侧栏要比底栏更明显：底栏靠变色就够（七格挨着，一眼能比），
              // 侧栏是纵向长条，不给个底色看不出来哪个亮着。
              //
              // ⚠ 底色用 bg-brand-500/10 而不是 --color-brand-50 ——
              // 后者是 @theme 里写死的浅蓝（#eef4ff），不随主题走，深色下会变成
              // 一条刺眼的亮带。半透明的品牌色压在 surface 上，两种主题都成立。
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition ${
                active ? 'bg-brand-500/10' : ''
              }`}
              style={{ color: active ? 'var(--color-brand-500)' : 'var(--muted)' }}
            >
              <NavIcon name={t.icon} className="h-[20px] w-[20px] shrink-0" />
              <span className="font-medium">{t.label}</span>
              {t.href === '/tasks' && !!badge && badge > 0 && (
                <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] leading-5 text-center">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* 全局的三样：跟当前是哪一页无关，所以不放页头放这里 —— 位置永远不变，
          页头也就只剩这一页自己的操作（「+ 新建」「总览」）。
          窄屏没有侧栏，它们仍在各页页头上（PageHeader 里 lg:hidden 那一段）。 */}
      <div className="shrink-0 border-t px-2 py-3 space-y-0.5" style={{ borderColor: 'var(--border)' }}>
        {[
          { href: '/search', label: '搜索', icon: <SearchIcon className="h-5 w-5 shrink-0" /> },
          { href: '/settings', label: '设置', icon: <SettingsIcon className="h-5 w-5 shrink-0" /> },
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
      </div>
    </nav>
  );
}
