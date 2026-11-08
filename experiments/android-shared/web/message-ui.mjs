import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import MessageBody from '../../../src/components/MessageBody.tsx';
import ConversationListView from '../../../src/components/chat/shared/ConversationListView.tsx';
import ConversationDrawer from '../../../src/components/chat/shared/ConversationDrawer.tsx';
import ChatTextInput from '../../../src/components/chat/shared/ChatTextInput.tsx';
import ChatBubble from '../../../src/components/chat/shared/ChatBubble.tsx';
import TaskCard from '../../../src/components/tasks/shared/TaskCard.tsx';
import TaskStatusSelect from '../../../src/components/tasks/shared/TaskStatusSelect.tsx';
import TaskOwnerSelect from '../../../src/components/tasks/shared/TaskOwnerSelect.tsx';
import TopicCardContent from '../../../src/components/topics/shared/TopicCardContent.tsx';
import BottomNavView from '../../../src/components/navigation/shared/BottomNavView.tsx';
import SideNavView from '../../../src/components/navigation/shared/SideNavView.tsx';
import AppShell from '../../../src/components/navigation/shared/AppShell.tsx';
import PageHeaderView from '../../../src/components/navigation/shared/PageHeaderView.tsx';
import { SearchIcon, SettingsIcon } from '../../../src/components/navigation/shared/HeaderIcons.tsx';
import MoreNavigationView from '../../../src/components/navigation/shared/MoreNavigationView.tsx';
import ThemeToggle from '../../../src/components/ThemeToggle.tsx';

// Only the platform mount and navigation policy live here. Markdown rendering
// remains the existing production component, imported without a fork.
function createTranscript(element, onLink) {
  const root = createRoot(element);
  element.addEventListener('click', event => {
    const link = event.target.closest?.('a');
    if (link && element.contains(link)) { event.preventDefault(); onLink(link.href); }
  });
  return {
    render(turns, interruptedNotice) {
      flushSync(() => root.render(turns.map(turn => createElement('li', { key: turn.id },
        createElement(ChatBubble, { role: 'user' }, turn.prompt),
        createElement(ChatBubble, { role: 'assistant' }, turn.status === 'complete'
          ? createElement('div', { className: 'shared-message' }, createElement(MessageBody, null, turn.reply))
          : turn.status === 'running' ? '正在处理…' : interruptedNotice),
      ))));
    },
  };
}
function createConversationControls(listElement, inputElement, callbacks, closeDrawer) {
  const listRoot = createRoot(listElement), inputRoot = createRoot(inputElement);
  return {
    render({ items, activeId, disabled, busy, draft, canSend }) {
      flushSync(() => {
        listRoot.render(createElement(ConversationListView, { items, activeId, disabled, t: text => text === '新对话' ? '新建对话' : text,
          onSelect: id => { if (callbacks.onSelect(id) !== false) closeDrawer(); },
          onNew: () => { if (callbacks.onNew() !== false) closeDrawer(); },
          onDelete: callbacks.onDelete }));
        inputRoot.render(createElement(ChatTextInput, { id: 'ai-prompt', value: draft, onDraftChange: callbacks.onDraftChange, onSend: callbacks.onSend,
          canSend, disabled: busy, maxLength: 1000, rows: 1, placeholder: '跟我说点什么…',
          className: 'w-full min-w-0 resize-none rounded-2xl border px-3.5 py-2.5 text-[15px] bg-transparent outline-none transition max-h-32' }));
      });
    },
  };
}
function createTaskCards(element, onChange) {
  const root = createRoot(element);
  const labels = { todo: '待办', doing: '进行中', blocked: '卡住了', done: '已完成', cancelled: '已取消' };
  return {
    render(groups, members) {
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
        createElement('div', { className: 'shared-task-actions' },
          createElement(TaskOwnerSelect, { owner: task.owner, members, t: text => text,
            onChange: value => onChange(task.id, { owner: value ?? '' }) }),
          createElement(TaskStatusSelect, { status: task.status, t: text => text,
            onChange: value => onChange(task.id, { status: value }) }))));
        return createElement('div', { key: group.status, className: 'shared-task-group' },
          createElement('h4', { className: 'shared-task-group-title' }, `${labels[group.status]} · ${group.items.length}`), cards);
      });
      flushSync(() => root.render(sections));
    },
  };
}
function createAppShell(element, content, onSelect, topicPlugins = []) {
  try {
    const pref = localStorage.getItem('theme') || 'system';
    document.documentElement.dataset.theme = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  } catch { /* Follow the system theme if local preferences are unavailable. */ }
  const shell = createRoot(element);
  flushSync(() => shell.render(createElement(AppShell, {
    side: createElement('div', { id: 'pilot-side-navigation' }),
    bottom: createElement('div', { id: 'pilot-navigation' }),
  }, createElement('div', { id: 'pilot-content-slot' }))));
  document.getElementById('pilot-content-slot').append(content);
  const bottom = createRoot(document.getElementById('pilot-navigation'));
  const side = createRoot(document.getElementById('pilot-side-navigation'));
  const header = createRoot(document.getElementById('pilot-page-header'));
  const more = createRoot(document.getElementById('pilot-more-navigation'));
  const topics = createRoot(document.getElementById('shared-topics-list'));
  const drawer = createRoot(document.getElementById('pilot-conversation-drawer'));
  let drawerOpen = false, currentPath = '/chat';
  function setDrawer(open) {
    drawerOpen = open;
    flushSync(() => drawer.render(createElement(ConversationDrawer, { open, onClose: closeDrawer, label: '对话列表', closeLabel: '关闭对话列表' },
      createElement('div', { id: 'shared-conversation-list', className: 'shared-conversation-list', 'aria-label': '本机对话' }))));
    renderHeader();
  }
  function closeDrawer() { setDrawer(false); }
  function renderHeader() {
    const titles = { '/chat': '对话', '/tasks': '任务', '/collections': '栏目', '/more': '更多', '/settings': '设置', '/search': '搜索',
      '/vault': '资料', '/finance': '财务', '/health': '健康', '/topics': '专题', '/files': '文件', '/pages': '页面', '/mail': '邮件' };
    for (const plugin of topicPlugins) titles[plugin.path] = plugin.title;
    flushSync(() => header.render(createElement(PageHeaderView, { title: titles[currentPath] || '栏目',
      back: currentPath === '/chat' ? createElement('button', { type: 'button', 'aria-label': '对话列表', 'aria-expanded': drawerOpen,
        'aria-controls': 'pilot-conversation-drawer', className: 'h-9 w-9 shrink-0 flex items-center justify-center rounded-lg muted',
        onClick: () => setDrawer(!drawerOpen) }, createElement('svg', { viewBox: '0 0 24 24', className: 'h-5 w-5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }, createElement('path', { d: 'M4 6h16M4 12h16M4 18h10' }))) : undefined,
      actions: createElement('span', { className: 'contents lg:hidden' }, createElement(ThemeToggle),
        currentPath !== '/search' && iconButton('搜索', SearchIcon, '/search'), currentPath !== '/settings' && iconButton('设置', SettingsIcon, '/settings')) })));
  }
  const navItem = ({ href, label, active, className, style, children }) => createElement('button', {
    key: href, type: 'button', className, style, 'aria-label': label,
    'aria-current': active ? 'page' : undefined, onClick: () => onSelect(href, label),
  }, children);
  const iconButton = (label, Icon, href) => createElement('button', {
    type: 'button', className: 'p-2 rounded-lg active:opacity-60 transition muted', 'aria-label': label,
    onClick: () => onSelect(href, label),
  }, createElement(Icon));
  return { render(pathname) {
    currentPath = pathname;
    if (drawerOpen && pathname !== '/chat') closeDrawer();
    flushSync(() => {
      bottom.render(createElement(BottomNavView, { pathname, t: text => text, renderItem: navItem }));
      side.render(createElement(SideNavView, { pathname, t: text => text, renderItem: navItem,
        trailing: createElement('div', { className: 'shrink-0 border-t px-2 py-3 space-y-0.5', style: { borderColor: 'var(--border)' } },
          iconButton('搜索', SearchIcon, '/search'), iconButton('设置', SettingsIcon, '/settings'), createElement(ThemeToggle, { withLabel: true })) }));
      more.render(createElement(MoreNavigationView, { t: text => text,
        renderItem: ({ href, label, children }) => createElement('button', { key: href, type: 'button',
          className: 'surface flex items-center gap-3 rounded-xl border p-4', style: { borderColor: 'var(--border)' },
          onClick: () => onSelect(href, label) }, children) }));
      topics.render(topicPlugins.map(plugin => createElement('button', { key: plugin.id, type: 'button', className: 'pilot-topic-card surface border rounded-2xl p-4', onClick: () => onSelect(plugin.path) },
        createElement(TopicCardContent, { title: plugin.title, summary: plugin.summary, category: plugin.category }))));
    });
    renderHeader();
  }, initDrawer() { setDrawer(false); }, closeDrawer };
}
globalThis.PilotMessageUI = { createTranscript, createConversationControls, createTaskCards, createAppShell };
