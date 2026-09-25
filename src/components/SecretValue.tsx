'use client';
import { useState } from 'react';
import { copyText } from '@/lib/clipboard';

/** 网址去掉协议头和末尾斜杠，手机上短一些 */
function prettyUrl(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

type Feedback = 'idle' | 'copied' | 'failed';

export default function SecretValue({ value, masked }: { value: string; masked: boolean }) {
  const [shown, setShown] = useState(!masked);
  const [feedback, setFeedback] = useState<Feedback>('idle');
  const isUrl = /^https?:\/\//.test(value);

  async function handleCopy() {
    const ok = await copyText(value);
    setFeedback(ok ? 'copied' : 'failed');
    // 复制不成功时把明文亮出来，至少能长按手动选
    if (!ok) setShown(true);
    setTimeout(() => setFeedback('idle'), ok ? 1500 : 4000);
  }

  return (
    // items-start：值换行成多行时，复制按钮跟着第一行走
    <span className="flex items-start gap-2 min-w-0">
      {isUrl && !masked ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer"
          // break-all 而不是 truncate —— 网址放不下就换行，别藏起来
          className="text-sm break-all text-brand-500 underline underline-offset-2 leading-5"
        >
          {prettyUrl(value)}
        </a>
      ) : (
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          className="flex items-start gap-1.5 min-w-0 text-left"
          // 打码时可以整块点开；没打码的就是普通文字，不用点
          disabled={!masked}
        >
          <span className="font-mono text-sm break-all leading-5 select-all">
            {shown ? value : '••••••••'}
          </span>
          {masked && (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 muted mt-0.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              {shown ? (
                <>
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                  <path d="m3 3 18 18" />
                </>
              ) : (
                <>
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              )}
            </svg>
          )}
        </button>
      )}

      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap"
        style={{
          borderColor: feedback === 'failed' ? '#ef4444' : 'var(--border)',
          color: feedback === 'failed' ? '#ef4444' : 'var(--muted)',
        }}
      >
        {feedback === 'copied' ? '已复制' : feedback === 'failed' ? '请长按选取' : '复制'}
      </button>
    </span>
  );
}
