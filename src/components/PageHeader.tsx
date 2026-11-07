'use client';

// 客户端组件：要用 useT() 翻 aria-label。服务端页面照样能用它 ——
// action 传的是 JSX，可以跨过服务端/客户端的边界。
import Link from 'next/link';
import ThemeToggle from './ThemeToggle';
import { useT } from '@/lib/i18n/client';
import PageHeaderView from '@/components/navigation/shared/PageHeaderView';
import { SettingsIcon, SearchIcon } from '@/components/navigation/shared/HeaderIcons';

export default function PageHeader({
  title,
  subtitle,
  action,
  search = true,
  settings = true,
  back,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** 搜索页自己不需要再指向自己 */
  search?: boolean;
  /** 设置页自己不需要再指向自己 */
  settings?: boolean;
  /** 详情页传上一级的地址，显示返回箭头。列表页不传。 */
  back?: string;
}) {
  const t = useT();
  return <PageHeaderView title={title} subtitle={subtitle} back={back ? <Link
              href={back}
              aria-label={t('返回')}
              className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full active:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link> : undefined}
    actions={<><span className="contents lg:hidden"><ThemeToggle />{search && <SearchLink />}{settings && <SettingsLink />}</span>{action}</>} />;
}

export function SettingsLink() {
  const t = useT();
  return (
    <Link
      href="/settings"
      aria-label={t('设置')}
      className="p-2 rounded-lg active:opacity-60 transition muted"
    >
      <SettingsIcon />
    </Link>
  );
}

/** 齿轮。页头和侧栏共用 */

export function SearchLink() {
  const t = useT();
  return (
    <Link
      href="/search"
      aria-label={t('搜索')}
      className="p-2 -mr-1 rounded-lg active:opacity-60 transition muted"
    >
      <SearchIcon />
    </Link>
  );
}

/** 放大镜。页头和侧栏共用 */
export { SettingsIcon, SearchIcon } from '@/components/navigation/shared/HeaderIcons';
