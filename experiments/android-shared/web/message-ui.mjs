import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import MessageBody from '../../../src/components/MessageBody.tsx';
import ConversationListView from '../../../src/components/chat/shared/ConversationListView.tsx';
import ConversationDrawer from '../../../src/components/chat/shared/ConversationDrawer.tsx';
import ChatTextInput from '../../../src/components/chat/shared/ChatTextInput.tsx';
import ChatBubble from '../../../src/components/chat/shared/ChatBubble.tsx';
import VoiceConversation from '../../../src/components/chat/VoiceConversation.tsx';
import SlideViewer from '../../../src/components/slides/SlideViewer.tsx';
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
import { createdLinks } from '../../../src/lib/chat/created-links.mjs';
import { TABS } from '../../../src/components/nav-tabs.tsx';

// Only the platform mount and navigation policy live here. Markdown rendering
// remains the existing production component, imported without a fork.
function createTranscript(element, onLink, onCreated) {
  const root = createRoot(element);
  element.addEventListener('click', event => {
    const link = event.target.closest?.('a');
    if (link && element.contains(link)) { event.preventDefault(); onLink(link.href); }
  });
  return {
    render(turns, interruptedNotice) {
      flushSync(() => root.render(turns.map(turn => createElement('li', { key: turn.id },
        createElement(ChatBubble, { role: 'user' }, turn.prompt),
        createElement(ChatBubble, { role: 'assistant' },
          turn.status === 'complete'
            ? createElement('div', { className: 'shared-message' }, createElement(MessageBody, null, turn.reply))
            : turn.status === 'running' ? '正在处理…' : interruptedNotice,
          typeof onCreated === 'function' && createdLinks(turn).map(link => createElement('button', {
            key: `${link.kind}:${link.id}`, type: 'button', className: 'chat-created-link',
            onClick: () => onCreated(link), 'aria-label': `打开幻灯片：${link.title}`,
          }, `打开幻灯片：${link.title}`))),
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
function createTaskChatInput(element, callbacks) {
  const root = createRoot(element);
  return { render({ draft, busy, disabled }) {
    flushSync(() => root.render(createElement(ChatTextInput, { id: 'task-chat-prompt', value: draft,
      onDraftChange: callbacks.onDraftChange, onSend: callbacks.onSend, canSend: !disabled && !busy && !!draft.trim(),
      disabled: disabled || busy, maxLength: 1000, rows: 1, placeholder: '讨论这个任务…',
      className: 'w-full min-w-0 resize-none rounded-2xl border px-3.5 py-2.5 text-[15px] bg-transparent outline-none transition max-h-32' })));
  } };
}
function createTaskCards(element, onChange, onLifecycle, onOpen) {
  const root = createRoot(element);
  const labels = { todo: '待办', doing: '进行中', blocked: '卡住了', done: '已完成', cancelled: '已取消' };
  return {
    render(groups, members, { archived = false, busy = false } = {}) {
      const sections = groups.map(group => {
        const cards = group.items.map(task => createElement(TaskCard, {
          key: task.id, title: task.title, completed: ['done', 'cancelled'].includes(task.status),
          highPriority: task.priority === 1 && !['done', 'cancelled'].includes(task.status), highPriorityLabel: '高优先级',
        },
        createElement('small', null, [labels[task.status] || task.status, task.category,
          '优先级' + ({ 1: '高', 2: '中', 3: '低' }[task.priority] || task.priority),
          task.dueDate ? '截止 ' + task.dueDate : '未设截止日', task.owner || '未指派'].join(' · ')),
        archived && task.archivedAt != null && createElement('small', null, '归档于 ' + new Date(task.archivedAt).toLocaleDateString('zh-CN')),
        task.detail && createElement('p', null, task.detail),
        task.result && createElement('p', null, '处理结果：' + task.result),
        createElement('div', { className: 'shared-task-actions' },
          createElement(TaskOwnerSelect, { owner: task.owner, members, disabled: archived || busy, t: text => text,
            onChange: value => onChange(task.id, { owner: value ?? '' }) }),
          createElement(TaskStatusSelect, { status: task.status, disabled: archived || busy, t: text => text,
            onChange: value => onChange(task.id, { status: value }) }),
          createElement('button', { type: 'button', className: 'secondary', disabled: busy, onClick: () => onOpen(task.id), 'aria-label': `查看详情：${task.title}` }, '详情'),
          createElement('button', { type: 'button', className: 'secondary', disabled: busy, onClick: () => onLifecycle(task.id, archived ? 'restore' : 'archive'), 'aria-label': `${archived ? '恢复' : '归档'}：${task.title}` }, archived ? '恢复' : '归档'),
          archived && createElement('button', { type: 'button', className: 'secondary task-delete', disabled: busy, onClick: () => onLifecycle(task.id, 'delete'), 'aria-label': `永久删除：${task.title}` }, '永久删除'))));
        return createElement('div', { key: group.status, className: 'shared-task-group' },
          createElement('h4', { className: 'shared-task-group-title' }, `${labels[group.status]} · ${group.items.length}`), cards);
      });
      flushSync(() => root.render(sections));
    },
  };
}
function createAppShell(element, content, onSelect, topicPlugins = [], getModules = () => ({ tasks: { enabled: true, pinned: true }, slides: { enabled: true, pinned: false } })) {
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
  let drawerOpen = false, currentPath = '/chat', taskTitle = '任务';
  function setDrawer(open) {
    drawerOpen = open;
    flushSync(() => drawer.render(createElement(ConversationDrawer, { open, onClose: closeDrawer, label: '对话列表', closeLabel: '关闭对话列表' },
      createElement('div', { id: 'shared-conversation-list', className: 'shared-conversation-list', 'aria-label': '本机对话' }))));
    renderHeader();
  }
  function closeDrawer() { setDrawer(false); }
  function renderHeader() {
    const titles = { '/chat': '对话', '/tasks': '任务', '/task-detail': taskTitle, '/task-chat': taskTitle, '/slides': '知识幻灯片', '/slides/view': '幻灯片', '/collections': '栏目', '/more': '更多', '/settings': '设置', '/search': '搜索',
      '/vault': '资料', '/finance': '财务', '/health': '健康', '/topics': '专题', '/files': '文件', '/pages': '页面', '/mail': '邮件' };
    for (const plugin of topicPlugins) titles[plugin.path] = plugin.title;
    flushSync(() => header.render(createElement(PageHeaderView, { title: titles[currentPath] || '栏目',
      back: currentPath === '/task-detail' || currentPath === '/task-chat' ? createElement('button', { type: 'button', 'aria-label': currentPath === '/task-chat' ? '返回任务详情' : '返回待办',
        className: 'h-9 w-9 shrink-0 flex items-center justify-center rounded-lg muted', onClick: () => onSelect(currentPath === '/task-chat' ? '/task-detail' : '/tasks') },
        createElement('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, createElement('path', { d: 'm15 18-6-6 6-6' }))) : currentPath === '/chat' ? createElement('button', { type: 'button', 'aria-label': '对话列表', 'aria-expanded': drawerOpen,
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
    const settings = getModules();
    const base = TABS.filter(tab => !('wideOnly' in tab && tab.wideOnly));
    const pinned = [base[0], ...(settings.tasks.enabled && settings.tasks.pinned ? [base[1]] : []),
      ...(settings.slides.enabled && settings.slides.pinned ? [{ href: '/slides', label: '幻灯片', icon: 'page' }] : [])];
    const remainder = base.filter(tab => !['/chat', '/tasks'].includes(tab.href));
    const tabs = [...pinned, ...remainder].slice(0, 6);
    const overflow = remainder.filter(tab => tab.href !== '/files' && !tabs.some(item => item.href === tab.href));
    flushSync(() => {
      const navigationPath = pathname === '/task-detail' || pathname === '/task-chat' ? '/tasks' : pathname;
      bottom.render(createElement(BottomNavView, { pathname: navigationPath, tabs, t: text => text, renderItem: navItem }));
      side.render(createElement(SideNavView, { pathname: navigationPath, t: text => text, renderItem: navItem,
        hiddenPaths: settings.tasks.enabled ? [] : ['/tasks'],
        collections: settings.slides.enabled && createElement('button', { type: 'button', className: 'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px]', onClick: () => onSelect('/slides') }, '知识幻灯片'),
        trailing: createElement('div', { className: 'shrink-0 border-t px-2 py-3 space-y-0.5', style: { borderColor: 'var(--border)' } },
          iconButton('搜索', SearchIcon, '/search'), iconButton('设置', SettingsIcon, '/settings'), createElement(ThemeToggle, { withLabel: true })) }));
      more.render(createElement('div', { className: 'space-y-3' },
        [...(settings.tasks.enabled && !settings.tasks.pinned ? [{ href: '/tasks', label: '待办' }] : []), ...overflow].map(tab =>
          createElement('button', { key: tab.href, type: 'button', className: 'surface flex items-center gap-3 rounded-xl border p-4', onClick: () => onSelect(tab.href) }, tab.label)),
        createElement(MoreNavigationView, { t: text => text,
        renderItem: ({ href, label, children }) => createElement('button', { key: href, type: 'button',
          className: 'surface flex items-center gap-3 rounded-xl border p-4', style: { borderColor: 'var(--border)' },
          onClick: () => onSelect(href, label) }, children) })));
      topics.render(topicPlugins.map(plugin => createElement('button', { key: plugin.id, type: 'button', className: 'pilot-topic-card surface border rounded-2xl p-4', onClick: () => onSelect(plugin.path) },
        createElement(TopicCardContent, { title: plugin.title, summary: plugin.summary, category: plugin.category }))));
    });
    renderHeader();
  }, setTaskTitle(title) { taskTitle = title || '任务'; }, initDrawer() { setDrawer(false); }, closeDrawer };
}
function createVoiceConversation(element, callbacks, services, nativeMicrophone) {
  const root = createRoot(element);
  return { render(active, disabled) {
    flushSync(() => root.render(createElement(VoiceConversation, {
      active, disabled, services, nativeMicrophone, manualOnly: true, workletUrl: '/assets/voice-capture.js',
      onRunningChange: callbacks.onRunningChange, onSubmit: callbacks.onSubmit,
    })));
  } };
}
function createSlideViewer(element) {
  const root = createRoot(element);
  return { render(deck) { flushSync(() => root.render(createElement(SlideViewer, { key: deck.id, title: deck.title, markdown: deck.markdown }))); } };
}
globalThis.PilotMessageUI = { createTranscript, createConversationControls, createTaskChatInput, createTaskCards, createAppShell, createVoiceConversation, createSlideViewer };
