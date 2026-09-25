'use client';
import { useState } from 'react';
import { copyText } from '@/lib/clipboard';

type Feedback = 'idle' | 'copied' | 'failed';

/**
 * 文稿的「复制全文 / 下载」。
 *
 * 起因：调研任务书、话术、命名简报这类文稿，写出来就是要**整段喂给另一个 AI** 的。
 * 以前只能在页面上手动全选 —— 手机上长按选中一篇两千字的文章几乎不可能选准，
 * 而且 Prose 渲染过的是 HTML，选出来的东西 Markdown 结构已经掉了。
 *
 * 所以复制的是 **body 原文（Markdown）**，不是页面上渲染后的文字。
 * 结构完整，粘到别的 AI 那边标题、表格、强调都还在。
 */
export default function CopyDoc({ body, title }: { body: string; title: string }) {
  const [feedback, setFeedback] = useState<Feedback>('idle');

  async function handleCopy() {
    const ok = await copyText(body);
    setFeedback(ok ? 'copied' : 'failed');
    setTimeout(() => setFeedback('idle'), ok ? 1800 : 5000);
  }

  function handleDownload() {
    // 文件名用标题，去掉文件系统不认的字符
    const safe = title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60) || 'document';
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 立刻 revoke 在部分浏览器会让下载失败，给它一会儿
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className="mt-4">
      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-brand-500 text-white text-sm font-medium py-2.5 active:bg-brand-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {feedback === 'copied' ? '已复制全文' : feedback === 'failed' ? '复制失败，长按下方正文' : '复制全文'}
        </button>
        <button
          onClick={handleDownload}
          className="shrink-0 flex items-center justify-center gap-2 rounded-xl border text-sm muted px-4 py-2.5 active:opacity-60"
          style={{ borderColor: 'var(--border)' }}
          aria-label="下载 Markdown 文件"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          .md
        </button>
      </div>
      <p className="muted text-[11px] mt-1.5">
        复制的是 Markdown 原文，粘到别的 AI 那边标题和表格都还在。
      </p>
    </div>
  );
}
