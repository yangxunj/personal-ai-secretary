import { createSlideDeckInput } from '../../../src/lib/slides/contracts.ts';

export function createSlides(storage) {
  return {
    list: () => storage.list(),
    read: id => storage.read(id),
    create(key, value) {
      const args = createSlideDeckInput.parse(value);
      const signature = 'createSlideDeck:' + JSON.stringify(args);
      return storage.readReceipt(key, signature) || storage.commitTool(key, signature, { kind: 'slide-create', values: args });
    },
  };
}

export function attachSlides(document, host, slides, open) {
  const list = document.getElementById('slides-list'), status = document.getElementById('slides-status');
  const viewer = host.PilotMessageUI.createSlideViewer(document.getElementById('slides-viewer'));
  function openDeck(id) {
    const deck = slides.read(id); if (!deck) return false;
    viewer.render(deck); open('/slides/view', deck.title); return true;
  }
  function refresh() {
    try {
      const rows = slides.list(); list.replaceChildren();
      document.getElementById('slides-empty').hidden = rows.length > 0;
      for (const row of rows) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'slide-list-item';
        button.textContent = row.title; button.addEventListener('click', () => {
          try { if (!openDeck(row.id)) throw new Error(); }
          catch { status.textContent = '无法打开幻灯片，请重试。'; }
        });
        list.append(button);
      }
      status.textContent = '';
    } catch { status.textContent = '无法读取幻灯片，请重试。'; }
  }
  document.getElementById('slides-back').addEventListener('click', () => open('/slides'));
  return { refresh, open: openDeck };
}
