'use client';
import { useEffect, useState } from 'react';

export type Shot = { id: string; label: string };

/**
 * 证件原件用的图片墙：缩略图排一行，点开在页内看大图。
 *
 * 为什么不用普通链接：原来附件是一行文字，点了跳到 /api/files/<id> 新标签页，
 * 看完还得手动切回来。证件是「在办事窗口前掏出手机找出生证明」的场景，
 * 跳走一次就断了 —— 所以大图必须在页内开、能一键关掉。
 *
 * 大图用 <img> 直接指向 /api/files/<id>，不做任何缩放处理：证件上的号码要看清，
 * 缩过的图等于没存。容器给 overflow-auto，手机上双指放大后能拖着看。
 *
 * **缩略图走 ?w=240，大图才是原件。** 96×96 的小方块没必要下 2 MB 的扫描件 ——
 * 原先就是这么干的，7 张缩略图拖着 5 MB，手机上就是几秒白屏。
 */
export default function ImageGallery({ shots }: { shots: Shot[] }) {
  const [open, setOpen] = useState<number | null>(null);

  // 大图开着的时候锁住背景滚动，否则手指在图上拖会带着整页跑
  useEffect(() => {
    if (open === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? null : (i + 1) % shots.length));
      if (e.key === 'ArrowLeft') setOpen((i) => (i === null ? null : (i - 1 + shots.length) % shots.length));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, shots.length]);

  const cur = open === null ? null : shots[open];

  return (
    <>
      <div className="mt-3 flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
        {shots.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setOpen(i)}
            className="shrink-0 w-24 rounded-xl overflow-hidden border active:opacity-70 transition text-left"
            style={{ borderColor: 'var(--border)' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/files/${s.id}?w=240`}
              alt={s.label}
              loading="lazy"
              width={96}
              height={96}
              className="w-24 h-24 object-cover block"
              style={{ background: 'var(--bg)' }}
            />
            <span className="muted text-[10px] leading-tight px-1.5 py-1 block truncate">{s.label}</span>
          </button>
        ))}
      </div>

      {cur && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={() => setOpen(null)}
        >
          <div className="flex items-center justify-between px-4 pt-safe h-14 shrink-0 text-white/90">
            <span className="text-sm truncate pr-3">
              {cur.label}
              {shots.length > 1 && (
                <span className="text-white/50 ml-2 text-xs">
                  {(open ?? 0) + 1}/{shots.length}
                </span>
              )}
            </span>
            <button
              onClick={() => setOpen(null)}
              className="shrink-0 text-sm px-3 py-1.5 rounded-lg border border-white/25"
            >
              关闭
            </button>
          </div>

          {/* 点图本身不关闭，否则想放大看号码时一碰就没了 */}
          <div className="flex-1 overflow-auto p-3" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${cur.id}`} alt={cur.label} className="max-w-none w-full h-auto rounded-lg" />
          </div>

          {shots.length > 1 && (
            <div className="flex gap-2 justify-center pb-safe pb-4 pt-2 shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setOpen((i) => (i === null ? null : (i - 1 + shots.length) % shots.length))}
                className="text-white/90 text-sm px-5 py-2 rounded-lg border border-white/25"
              >
                上一张
              </button>
              <button
                onClick={() => setOpen((i) => (i === null ? null : (i + 1) % shots.length))}
                className="text-white/90 text-sm px-5 py-2 rounded-lg border border-white/25"
              >
                下一张
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
