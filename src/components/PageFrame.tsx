'use client';

import { useEffect, useRef } from 'react';

/**
 * 嵌 AI 页面的 iframe，外加 pageStore 的另一半（页面里那一半在 lib/pages.ts 的 SHIM）。
 *
 * 页面在沙箱里，没有 origin、调不了接口。它 postMessage 过来「读/写哪个 key」，
 * 这里替它调 /api/pages/<id>/data 再把结果发回去。
 *
 * 两条防线：
 *   - 只认 `e.source === iframe.contentWindow` 的消息 —— 平台里别的窗口冒充不了
 *   - pageId 用 props 里的，**不用消息里带的** —— 页面只能碰自己那一份
 *
 * 回信只能用 targetOrigin '*'：沙箱页面的 origin 是 "null"，写不出别的。
 * 发回去的只是它自己的数据，没有平台的东西。
 */
export default function PageFrame({
  id,
  src,
  title,
  className,
}: {
  id: string;
  src: string;
  title: string;
  className?: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const w = ref.current?.contentWindow;
      if (!w || e.source !== w) return;
      const d = e.data;
      if (!d || d.__pageStore !== 1 || typeof d.id !== 'number' || typeof d.op !== 'string') return;
      const reply = (r: { ok: boolean; value?: unknown; error?: string }) =>
        w.postMessage({ __pageStoreReply: 1, id: d.id, ok: r.ok, value: r.value ?? null, error: r.error }, '*');
      fetch(`/api/pages/${encodeURIComponent(id)}/data`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: d.op, key: d.key, value: d.value }),
      })
        .then((r) => r.json())
        .then(reply, () => reply({ ok: false, error: 'network error' }));
    }
    window.addEventListener('message', onMessage);
    // src 等监听挂上之后才给。服务端渲染时就带上 src 的话，iframe 可能在 React 水合、
    // 这个 effect 跑起来之前就加载完并发出第一个 get —— 消息没人接，页面卡在「加载中」（实测踩过）
    if (ref.current && ref.current.getAttribute('src') !== src) ref.current.setAttribute('src', src);
    return () => window.removeEventListener('message', onMessage);
  }, [id, src]);

  return <iframe ref={ref} title={title} sandbox="allow-scripts allow-downloads" className={className} />;
}
