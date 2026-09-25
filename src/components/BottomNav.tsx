'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TABS, NavIcon } from './nav-tabs';

/**
 * 窄屏的底部导航。宽屏（lg 及以上）上不显示 —— 那边走 `SideNav`。
 *
 * 底部七格是手机习惯，1400px 的屏幕上又丑又远（手要横跨整个屏幕去够）。
 * 标签清单和图标在 `nav-tabs.tsx`，两边共用。
 */
export default function BottomNav({ badge }: { badge?: number }) {
  const pathname = usePathname();
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t surface pb-safe"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="mx-auto max-w-2xl grid grid-cols-7">
        {TABS.filter((t) => !('wideOnly' in t && t.wideOnly)).map((t) => {
          // 原来第一格是 '/'，要特判才不会匹配所有路径。现在没有 '/' 这一格了，
          // 统一按「正好相等，或者是它的子路径」判断：/tasks/123 高亮任务，
          // 而 /chat 不会被别的格子抢走。
          const active = pathname === t.href || pathname.startsWith(t.href + '/');
          return (
            <Link
              key={t.href}
              href={t.href}
              className="flex flex-col items-center gap-1 py-2.5 transition"
              style={{ color: active ? 'var(--color-brand-500)' : 'var(--muted)' }}
            >
              <span className="relative">
                <NavIcon name={t.icon} className="h-[22px] w-[22px]" />
                {t.href === '/tasks' && !!badge && badge > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center">
                    {badge}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
