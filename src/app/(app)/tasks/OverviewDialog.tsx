'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 页头上的「总览」按钮 + 弹窗。内容（TaskOverview）是服务端组件，
 * 作为 children 传进来 —— 查库留在服务端，这里只管开关。
 *
 * 为什么是弹窗而不是右栏：右栏只要有东西，就一定是某条任务的详情。
 * 总览是另一种性质的内容，混在同一块区域里，看的人得先判断「现在这是哪种」。
 * 弹窗顺带让手机上也有了总览 —— 原来它只在宽屏右栏出现。
 *
 * ⚠ **弹窗必须 portal 到 body。** 按钮在左栏里，而左栏是 lg:sticky —— sticky 自成
 * 一个层叠上下文，里面的 z-50 出不了左栏，右栏的详情（DOM 在后面）就盖在弹窗上面：
 * 实测输入框的占位文字透过弹窗叠在「已逾期」卡片上。
 *
 * 点总览里的任何链接都会跳走，所以点到 <a> 就顺手关掉，
 * 不然跳到了筛选结果，弹窗还盖在上面。
 */
export default function OverviewDialog({
  children,
  alert = 0,
}: {
  children: React.ReactNode;
  /** 逾期条数。>0 时按钮上挂红色数字 —— 总览最该被点开的时候，按钮就该最显眼 */
  alert?: number;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    // 弹窗开着时底下的页面别跟着滚
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* 第一版是跟筛选胶囊一样的灰边框小字「总览」，挨着实心蓝的「+ 新建」
          几乎看不见。改成品牌色浅底 + 图标 + 全称：次于「+ 新建」、但一眼能认出
          是个入口；有逾期时再挂红色数字，给「为什么现在该点它」一个理由。 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 text-brand-600 dark:text-brand-300 hover:bg-brand-500/20 active:opacity-70 transition"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
        任务总览
        {alert > 0 && (
          <span
            className="absolute -top-2 -right-2 min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] leading-5 text-center shadow"
            aria-label={`${alert} 条已逾期`}
          >
            {alert}
          </span>
        )}
      </button>

      {open &&
        createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 p-0 sm:p-6"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="任务总览"
        >
          <div
            className="surface relative w-full sm:max-w-4xl max-h-dvh sm:max-h-[88dvh] overflow-y-auto sm:rounded-2xl shadow-xl"
            onClick={(e) => {
              e.stopPropagation();
              if ((e.target as HTMLElement).closest('a')) setOpen(false);
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭"
              className="absolute top-4 right-4 h-8 w-8 rounded-full flex items-center justify-center muted hover:opacity-70"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
            {children}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
