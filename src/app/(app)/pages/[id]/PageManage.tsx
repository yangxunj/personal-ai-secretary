'use client';

import { useState, useTransition } from 'react';
import { deletePage, restorePage } from '../actions';

/**
 * 详情页底下：历史版本 + 删除。
 *
 * 删除两步确认、第二步才是红的，跟附件一个规矩（见 AttachmentRow）。
 * 恢复旧版不用确认：当前这版会先存成历史，点错了再点回来就行。
 */
export default function PageManage({
  id,
  versions,
}: {
  id: string;
  versions: { id: string; title: string; at: string }[];
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      {versions.length > 0 && (
        <details className="surface border rounded-2xl" style={{ borderColor: 'var(--border)' }}>
          <summary className="px-4 py-3 text-sm cursor-pointer select-none">
            历史版本 <span className="muted">（{versions.length}）</span>
          </summary>
          <ul className="px-2 pb-2">
            {versions.map((v, i) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-2 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="muted text-[12px] mr-2">{v.at}</span>
                  {v.title}
                  {i === 0 && <span className="muted text-[11px] ml-1.5">上一版</span>}
                </span>
                <button
                  disabled={pending}
                  onClick={() => start(() => restorePage(id, v.id))}
                  className="shrink-0 text-[12px] px-2.5 py-1 rounded-lg border active:opacity-60 disabled:opacity-50"
                  style={{ borderColor: 'var(--border)' }}
                >
                  恢复这版
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            disabled={pending}
            onClick={() => start(() => deletePage(id))}
            className="text-[12px] px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 font-medium active:opacity-60 disabled:opacity-50"
          >
            {pending ? '删除中…' : '确定删除（连同历史版本）'}
          </button>
          <button onClick={() => setConfirming(false)} className="text-[12px] px-2 py-1.5 muted">
            取消
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className="text-[12px] muted hover:text-red-500 transition">
          删除这个页面
        </button>
      )}
    </div>
  );
}
