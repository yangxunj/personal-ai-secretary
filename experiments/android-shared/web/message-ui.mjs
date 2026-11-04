import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import MessageBody from '../../../src/components/MessageBody.tsx';
import ConversationListView from '../../../src/components/chat/shared/ConversationListView.tsx';
import ChatTextInput from '../../../src/components/chat/shared/ChatTextInput.tsx';

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
function createConversationControls(listElement, inputElement, callbacks) {
  const listRoot = createRoot(listElement), inputRoot = createRoot(inputElement);
  return {
    render({ items, activeId, disabled, busy, draft, canSend }) {
      flushSync(() => {
        listRoot.render(createElement(ConversationListView, { items, activeId, disabled, t: text => text === '新对话' ? '新建对话' : text, onSelect: callbacks.onSelect, onNew: callbacks.onNew }));
        inputRoot.render(createElement(ChatTextInput, { id: 'ai-prompt', value: draft, onDraftChange: callbacks.onDraftChange, onSend: callbacks.onSend,
          canSend, disabled: busy, maxLength: 1000, rows: 3, placeholder: '例如：帮我建一条待办，周五前预约牙科检查',
          className: 'w-full min-w-0 resize-none rounded-2xl border px-3.5 py-2.5 text-[15px] bg-transparent outline-none transition max-h-32' }));
      });
    },
  };
}
globalThis.PilotMessageUI = { createTranscript, createConversationControls };
