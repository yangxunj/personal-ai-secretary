/**
 * 导航的唯一真相 —— 底栏（`BottomNav`，窄屏）和侧栏（`SideNav`，宽屏）
 * 共用这一份。
 *
 * **加一个入口只改这个文件**，两边自动跟上。抽出来之前这两份各有一套
 * TABS 和图标，改一处漏一处是迟早的事。
 */

export const TABS = [
  // ★ 这一格原来是「记录」（消息时间线）。这一版的核心是网页内对话，
  //   而对话产生的就是那些记录 —— 所以记录页已经并进对话页，
  //   `/` 只剩一句 redirect。别再把「记录」拆回来当独立入口。
  { href: '/chat', label: '对话', icon: 'chat' },
  { href: '/tasks', label: '任务', icon: 'check' },
  { href: '/vault', label: '资料', icon: 'vault' },
  { href: '/finance', label: '财务', icon: 'coin' },
  { href: '/health', label: '健康', icon: 'heart' },
  // 专题接管了原来「文稿」那一格。底栏七个已经挤满，而文稿当时只有 1 篇 ——
  // 一级入口该给天天用得上的东西。文稿的入口收在专题页里，等真写多了再让它长回来。
  { href: '/topics', label: '专题', icon: 'topic' },
  { href: '/files', label: '文件', icon: 'file' },
  // AI 在对话里做的网页（lib/pages.ts）。只上侧栏不上底栏：底栏七格已满，
  // 手机上的入口在专题页底部，跟文稿一样。wideOnly 就是这个意思
  { href: '/pages', label: '页面', icon: 'page', wideOnly: true },
] as const satisfies readonly { href: string; label: string; icon: string; wideOnly?: boolean }[];

export type TabIcon = (typeof TABS)[number]['icon'];

const PATHS: Record<string, React.ReactNode> = {
  chat: <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />,
  check: <path d="M4 6h16M4 12h16M4 18h10" />,
  vault: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.5A2.5 2.5 0 0 0 12 8h-.5a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4H12a2.5 2.5 0 0 1-2.5-1.5M12 6.5v11" />
    </>
  ),
  doc: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </>
  ),
  file: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />,
  topic: (
    <>
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h5A2.5 2.5 0 0 1 13 5.5v3A2.5 2.5 0 0 1 10.5 11h-5A2.5 2.5 0 0 1 3 8.5Z" />
      <path d="M11 15.5A2.5 2.5 0 0 1 13.5 13h5A2.5 2.5 0 0 1 21 15.5v3A2.5 2.5 0 0 1 18.5 21h-5A2.5 2.5 0 0 1 11 18.5Z" />
    </>
  ),
  page: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 13.5l-2 2 2 2M16 13.5l2 2-2 2M13 13l-2 5" />
    </>
  ),
  heart: <path d="M19.5 12.6 12 20l-7.5-7.4a4.6 4.6 0 0 1 0-6.6 4.8 4.8 0 0 1 6.7 0l.8.8.8-.8a4.8 4.8 0 0 1 6.7 0 4.6 4.6 0 0 1 0 6.6Z" />,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
