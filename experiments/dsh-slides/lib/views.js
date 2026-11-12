export function splitPages(markdown) {
  return markdown.split(/^\s*---\s*$/m).map(page => page.trim()).filter(Boolean).flatMap(page => {
    const chunks = []; for (let i = 0; i < page.length; i += 1800) chunks.push(page.slice(i, i + 1800)); return chunks;
  });
}
export function listView(decks) {
  return { type: 'stack', title: '知识幻灯片', children: decks.length
    ? [{ type: 'text', text: '选择一份幻灯片。' }, { type: 'list', items: decks.slice(0, 50).map(deck => ({ title: deck.title, icon: 'slides', action: { id: 'open', args: { id: deck.id } } })) }]
    : [{ type: 'text', text: '还没有幻灯片。在对话中请 AI 为你制作一份。' }] };
}
export function deckView(deck, page) {
  const pages = splitPages(deck.markdown), index = Math.max(0, Math.min(page, pages.length - 1));
  const actions = [{ label: '返回列表', action: 'list' }];
  if (index > 0) actions.push({ label: '上一页', action: 'previous' });
  if (index < pages.length - 1) actions.push({ label: '下一页', action: 'next' });
  return { type: 'stack', title: deck.title, children: [
    { type: 'text', text: `${deck.title} · ${index + 1} / ${pages.length}` },
    { type: 'text', text: pages[index] || '此页没有内容。' }, { type: 'actions', items: actions },
  ] };
}
