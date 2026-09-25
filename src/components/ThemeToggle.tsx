'use client';
import { useEffect, useState } from 'react';

type Pref = 'system' | 'light' | 'dark';

const NEXT: Record<Pref, Pref> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Pref, string> = { system: '跟随系统', light: '浅色', dark: '深色' };

/** 把偏好落到 <html data-theme> 上，并同步浏览器地址栏的颜色。 */
function apply(pref: Pref) {
  const dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // ⚠ 单独同步 theme-color：它是 <meta>，不吃 CSS 变量。不改的话手动切成浅色后，
  // 手机上浏览器/PWA 的顶栏还是深色，接缝很明显。
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    m.removeAttribute('media');
    m.content = dark ? '#12151b' : '#f6f7f9';
  }
}

/**
 * 三态主题开关：跟随系统 → 浅色 → 深色 → 跟随系统。
 *
 * 为什么留「跟随系统」而不是只做两态：手机晚上自动转深色是系统层面的事，
 * 大多数时候跟着走就对了。手动两态会把这个能力弄丢，而且没有「恢复默认」的出路。
 *
 * 首次绘制前的初始化在 layout 的内联脚本里，这里只负责**切换**和**监听系统变化**。
 */
export default function ThemeToggle({ withLabel = false }: { withLabel?: boolean } = {}) {
  const [pref, setPref] = useState<Pref>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let saved: Pref = 'system';
    try {
      saved = (localStorage.getItem('theme') as Pref) || 'system';
    } catch {
      /* 隐身模式读不了，当作跟随系统 */
    }
    setPref(saved);
    setReady(true);

    // 只有「跟随系统」时才需要跟着系统变；手动选过就不再被系统覆盖。
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      let cur: Pref = 'system';
      try {
        cur = (localStorage.getItem('theme') as Pref) || 'system';
      } catch {}
      if (cur === 'system') apply('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function cycle() {
    const next = NEXT[pref];
    setPref(next);
    try {
      localStorage.setItem('theme', next);
    } catch {}
    apply(next);
  }

  const icon =
    !ready || pref === 'system' ? (
      // 半明半暗：跟随系统
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4a8 8 0 0 0 0 16Z" fill="currentColor" stroke="none" />
      </svg>
    ) : pref === 'light' ? (
      // 太阳：浅色
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </svg>
    ) : (
      // 月亮：深色
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
      </svg>
    );

  // 侧栏里是一整行、带字：只有一个半明半暗的图标，没人认得出那是「跟随系统」。
  if (withLabel) {
    return (
      <button
        onClick={cycle}
        aria-label={`主题：${LABEL[pref]}，点击切换`}
        className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] muted hover:bg-brand-500/5 transition"
      >
        {icon}
        <span className="font-medium">主题</span>
        <span className="ml-auto text-[12px] opacity-80">{ready ? LABEL[pref] : LABEL.system}</span>
      </button>
    );
  }

  return (
    <button
      onClick={cycle}
      aria-label={`主题：${LABEL[pref]}，点击切换`}
      title={`主题：${LABEL[pref]}`}
      // 服务端渲染不知道用户选了什么，先按「跟随系统」画；ready 之后才可能换图标。
      // 不这样会 hydration 不匹配。
      className="p-2 rounded-lg active:opacity-60 transition muted"
    >
      {icon}
    </button>
  );
}
