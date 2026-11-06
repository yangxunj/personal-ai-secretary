import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import MessageBody from '../../../src/components/MessageBody.tsx';
import ConversationListView from '../../../src/components/chat/shared/ConversationListView.tsx';
import ChatTextInput from '../../../src/components/chat/shared/ChatTextInput.tsx';
import TaskCard from '../../../src/components/tasks/shared/TaskCard.tsx';

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
function createTaskCards(element, onDone) {
  const root = createRoot(element);
  const labels = { todo: '待办', doing: '进行中', blocked: '卡住了', done: '已完成', cancelled: '已取消' };
  return {
    render(groups) {
      const sections = groups.map(group => {
        const cards = group.items.map(task => createElement(TaskCard, {
          key: task.id, title: task.title, completed: ['done', 'cancelled'].includes(task.status),
          highPriority: task.priority === 1 && !['done', 'cancelled'].includes(task.status), highPriorityLabel: '高优先级',
        },
        createElement('small', null, [labels[task.status] || task.status, task.category,
          '优先级' + ({ 1: '高', 2: '中', 3: '低' }[task.priority] || task.priority),
          task.dueDate ? '截止 ' + task.dueDate : '未设截止日', task.owner || '未指派'].join(' · ')),
        task.detail && createElement('p', null, task.detail),
        task.result && createElement('p', null, '处理结果：' + task.result),
        !['done', 'cancelled'].includes(task.status) && createElement('button', {
          type: 'button', className: 'secondary shared-task-done', 'aria-label': '完成 ' + task.title,
          onClick: () => onDone(task.id),
        }, '标记完成')));
        return createElement('div', { key: group.status, className: 'shared-task-group' },
          createElement('h4', { className: 'shared-task-group-title' }, `${labels[group.status]} · ${group.items.length}`), cards);
      });
      flushSync(() => root.render(sections));
    },
  };
}
globalThis.PilotMessageUI = { createTranscript, createConversationControls, createTaskCards };
