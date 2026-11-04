import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import MessageBody from '../../../src/components/MessageBody.tsx';

// Only the platform mount and navigation policy live here. Markdown rendering
// remains the existing production component, imported without a fork.
function createTranscript(element, onLinkBlocked) {
  const root = createRoot(element);
  element.addEventListener('click', event => {
    const link = event.target.closest?.('a');
    if (link && element.contains(link)) { event.preventDefault(); onLinkBlocked(); }
  });
  return {
    render(turns, interruptedNotice) {
      flushSync(() => root.render(turns.map(turn => createElement('li', { key: turn.id },
        createElement('p', { className: 'chat-user' }, '我：' + turn.prompt),
        turn.status === 'complete'
          ? createElement('div', { className: 'shared-message' }, createElement('p', { className: 'chat-speaker' }, '秘书：'), createElement(MessageBody, null, turn.reply))
          : createElement('p', null, turn.status === 'running' ? '正在处理…' : interruptedNotice),
      ))));
    },
  };
}
globalThis.PilotMessageUI = { createTranscript };
