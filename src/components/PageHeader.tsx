import Link from 'next/link';
import ThemeToggle from './ThemeToggle';

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
  return (
    <header className="sticky top-0 z-20 surface border-b pt-safe" style={{ borderColor: 'var(--border)' }}>
      <div className={`flex items-center justify-between h-14 ${back ? 'pl-1 pr-4' : 'px-4'}`}>
        <div className="flex items-center gap-1 min-w-0">
          {back && (
            <Link
              href={back}
              aria-label="返回"
              className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full active:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </Link>
          )}
          {/* 详情页标题可能很长（「2025 年某某医院体检」），截断而不是换行 ——
              标题栏高度固定，撑开会把内容挤下去 */}
          <div className="min-w-0">
            <h1 className="font-semibold truncate">{title}</h1>
            {subtitle && <p className="muted text-[11px] -mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 主题开关摆在这里而不是单开一个设置页：一共就一个开关，为它开一页不值当；
              而且底栏七格已满，塞不下。放在页头搜索旁边，每一页都够得着。 */}
          {/* 主题 / 搜索 / 设置是全局的，跟哪一页无关。宽屏上它们在侧栏底部，
              页头只留这一页自己的操作；窄屏没有侧栏，才放在这里。 */}
          <span className="contents lg:hidden">
          <ThemeToggle />
          {search && <SearchLink />}
          {/* 设置入口原来只在首页有一个小齿轮，使用者找不到「API Key 填哪儿」。
              放进公共页头，每一页右上角都够得着 —— 人找设置就是往右上角看。
              设置页自己不用再指向自己。 */}
          {settings && <SettingsLink />}
          </span>
          {action}
        </div>
      </div>
    </header>
  );
}

export function SettingsLink() {
  return (
    <Link
      href="/settings"
      aria-label="设置"
      className="p-2 rounded-lg active:opacity-60 transition muted"
    >
      <SettingsIcon />
    </Link>
  );
}

/** 齿轮。页头和侧栏共用 */
export function SettingsIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
  );
}

export function SearchLink() {
  return (
    <Link
      href="/search"
      aria-label="搜索"
      className="p-2 -mr-1 rounded-lg active:opacity-60 transition muted"
    >
      <SearchIcon />
    </Link>
  );
}

/** 放大镜。页头和侧栏共用 */
export function SearchIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}
