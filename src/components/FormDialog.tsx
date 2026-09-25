'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 页头上的「+ 新建」按钮 + 居中弹窗，里面放一张表单。
 *
 * 原来叫 Collapsible，表单直接展开在按钮后面 —— 可按钮在页头的横排里，
 * 展开的东西没底色、没遮罩，宽屏上还被 sticky 的左栏截掉一截。
 * 跟 OverviewDialog 一样 **portal 到 body**，理由也一样：sticky 自成层叠上下文，
 * 不 portal 出去，z-50 也盖不住右栏。
 *
 * 表单提交后自动关：监听冒泡上来的 submit（required 没填时浏览器不会发这个事件，
 * 弹窗就留着）。关的时候 server action 已经发出去了，卸载表单不会打断它。
 */
export default function FormDialog({
  label,
  title,
  children,
}: {
  /** 按钮上的字 */
  label: string;
  /** 弹窗标题 */
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm px-3 py-1.5 rounded-lg bg-brand-500 text-white active:bg-brand-700 transition"
      >
        {label}
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div
              className="surface relative w-full max-w-md max-h-[88dvh] overflow-y-auto rounded-2xl shadow-xl p-5"
              onClick={(e) => e.stopPropagation()}
              onSubmit={() => setTimeout(() => setOpen(false), 0)}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">{title}</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭"
                  className="h-8 w-8 -mr-2 rounded-full flex items-center justify-center muted hover:opacity-70"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
              {children}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
