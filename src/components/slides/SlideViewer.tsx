'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Marp } from '@marp-team/marp-core';

const allowed = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'S', 'DEL', 'CODE', 'PRE', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'BR', 'HR', 'SPAN']);
const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'VIDEO', 'AUDIO']);

/** Copy only inert elements from Marp output. Never insert generated HTML directly. */
function safeNode(node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
  if (!(node instanceof Element) || blocked.has(node.tagName)) return null;
  const copy = document.createElement(allowed.has(node.tagName) ? node.tagName.toLowerCase() : 'span');
  if (node.tagName === 'TH' || node.tagName === 'TD') for (const attr of ['colspan', 'rowspan']) {
    const value = node.getAttribute(attr); if (value && /^[1-9][0-9]?$/.test(value)) copy.setAttribute(attr, value);
  }
  for (const child of node.childNodes) { const safe = safeNode(child); if (safe) copy.appendChild(safe); }
  return copy;
}

export default function SlideViewer({ title, markdown, inlineStyles }: { title: string; markdown: string; inlineStyles?: { theme: string; adaptive: string } }) {
  const [page, setPage] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const result = useMemo(() => {
    try {
      const rendered = new Marp({ html: false, inlineSVG: false }).render(markdown);
      const doc = new DOMParser().parseFromString(rendered.html, 'text/html');
      const sections = [...doc.querySelectorAll('.marpit > section')];
      return { sections, error: !sections.length };
    } catch { return { sections: [] as Element[], error: true }; }
  }, [markdown]);
  useEffect(() => { setPage(0); }, [markdown]);
  useEffect(() => {
    const element = host.current; if (!element || !result.sections.length) return;
    const shadow = element.shadowRoot || element.attachShadow({ mode: 'open' });
    const theme = inlineStyles ? document.createElement('style') : document.createElement('link');
    const adaptive = inlineStyles ? document.createElement('style') : document.createElement('link');
    if (inlineStyles) { theme.textContent = inlineStyles.theme; adaptive.textContent = inlineStyles.adaptive; }
    else { (theme as HTMLLinkElement).rel = 'stylesheet'; (theme as HTMLLinkElement).href = '/assets/marp-theme.css'; (adaptive as HTMLLinkElement).rel = 'stylesheet'; (adaptive as HTMLLinkElement).href = '/assets/slide-view.css'; }
    const wrapper = document.createElement('div'); wrapper.className = 'marpit';
    const section = document.createElement('section');
    for (const child of result.sections[Math.min(page, result.sections.length - 1)].childNodes) {
      const safe = safeNode(child); if (safe) section.appendChild(safe);
    }
    wrapper.appendChild(section); shadow.replaceChildren(theme, adaptive, wrapper);
  }, [result, page, inlineStyles]);
  if (result.error) return <p role="alert">无法渲染这份幻灯片，请检查内容。</p>;
  return <div className="slides-reader">
    <h3>{title}</h3><div ref={host} aria-label="幻灯片内容" />
    <div className="slides-controls">
      <button type="button" disabled={page <= 0} onClick={() => setPage(value => value - 1)}>上一页</button>
      <span role="status">{Math.min(page + 1, result.sections.length)} / {result.sections.length}</span>
      <button type="button" disabled={page >= result.sections.length - 1} onClick={() => setPage(value => value + 1)}>下一页</button>
    </div>
  </div>;
}
