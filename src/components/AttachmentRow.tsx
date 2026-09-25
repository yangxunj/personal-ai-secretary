'use client';
import { useState, useTransition } from 'react';
import { deleteAttachment } from '@/app/(app)/actions';
import { humanSize } from '@/lib/format';

/**
 * 详情页上的一个附件：点开看，右边一个删除。
 *
 * ★ **两步确认，而且第二步的按钮才是红的。** 这是真删（数据库记录 + 磁盘文件），
 * 没有回收站、没有撤销。一步就能删的东西迟早会被误删 ——
 * 而这里放的是签证、合约、报价单。
 *
 * 收起状态下删除只是一个不起眼的 ✕：**日常翻附件的人不该被一排红按钮盯着看。**
 */
export default function AttachmentRow({
  id,
  filename,
  size,
  hint,
}: {
  id: string;
  filename: string;
  size: number;
  hint?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div
      className="flex items-center gap-3 surface border rounded-2xl p-3"
      style={{ borderColor: 'var(--border)' }}
    >
      <a href={`/api/files/${id}`} target="_blank" className="flex items-center gap-3 min-w-0 flex-1 active:opacity-70">
        <div className="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center" style={{ background: 'var(--bg)' }}>
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm break-all">{filename}</p>
          <p className="muted text-[11px]">
            {humanSize(size)}
            {hint && ` · ${hint}`}
          </p>
        </div>
      </a>

      {confirming ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            disabled={pending}
            onClick={() => start(() => void deleteAttachment(id))}
            className="text-[11px] px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 font-medium active:opacity-60 disabled:opacity-50"
          >
            {pending ? '删除中…' : '确定删除'}
          </button>
          <button
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="text-[11px] px-2 py-1.5 rounded-lg muted active:opacity-60"
          >
            取消
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          aria-label={`删除 ${filename}`}
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg muted active:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
