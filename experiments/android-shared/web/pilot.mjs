// This is the same module used by the existing web/Windows collection service.
import { parseDefinition, validateValues, collectionError, CollectionError, MAX_RECORDS } from '../../../src/lib/collections/schema.ts';
import { prepareRecordWrite } from '../../../src/lib/collections/record-write.ts';
import { runPilotAgent, demoModelRequest } from './pi-runtime.mjs';
import { attachAiPanel } from './ai-panel.mjs';
import { attachTaskChat } from './task-chat.mjs';
import { createSlides, attachSlides } from './slides.mjs';
import { topicPlugins } from '../../../src/topic-plugins/registry.mjs';
import { mountTopicPlugins } from './topic-plugin-adapters.mjs';
import { createTasks, attachTaskPanel, taskPolicy, lifecyclePolicy, projectTaskList, parseOwners } from './tasks.mjs';
import * as conversation from '../../../src/lib/pi/conversation.mjs';
import * as titleWork from './title-work.mjs';

export const definition = parseDefinition({
  title: '平板书单', view: 'cards', titleFieldId: 'name', fields: [
    { id: 'name', label: '书名', type: 'text', required: true },
    { id: 'date', label: '阅读日期', type: 'date' },
    { id: 'status', label: '阅读状态', type: 'select', required: true, options: ['想读', '在读', '读完'] },
  ],
});

export function runRuleChecks() {
  const cases = [
    ['正常记录', { name: '小王子', date: '2024-02-29', status: '想读' }, null],
    ['书名必填', { name: ' ', status: '想读' }, 'required'],
    ['无效日期', { name: '测试', date: '2025-02-29', status: '想读' }, 'type'],
    ['状态范围', { name: '测试', status: '不存在' }, 'type'],
    ['未知字段', { name: '测试', status: '想读', other: true }, 'unknownField'],
    ['书名长度', { name: '书'.repeat(201), status: '想读' }, 'type'],
  ];
  const checks = cases.map(([name, input, expected]) => {
    let actual = null;
    try { validateValues(definition, input); } catch (error) { actual = error.code || 'unexpected'; }
    return { name, passed: actual === expected, expected, actual };
  });
  try {
    const current = { values: { name: '旧书名', status: '在读', date: '2024-02-29' }, version: 1, archived: false };
    const prepared = prepareRecordWrite(definition, { name: '新书名' }, current, 1);
    checks.push({ name: '共用局部更新', passed: prepared.title === '新书名' && prepared.values.status === '在读' && prepared.values.date === '2024-02-29' });
    let conflict = false;
    try { prepareRecordWrite(definition, { name: '旧版本覆盖' }, current, 0); }
    catch (error) { conflict = error.code === 'conflict'; }
    checks.push({ name: '共用版本保护', passed: conflict });
  } catch { checks.push({ name: '共用写入模块', passed: false }); }
  try {
    const created = taskPolicy.prepareTaskCreate({ title: '保留原标题', detail: '保留原始要求' });
    checks.push({ name: '共用待办默认值', passed: created.status === 'todo' && created.priority === 2 && created.dueDate === null && created.detail === '保留原始要求' });
    const patch = taskPolicy.prepareTaskUpdate({ id: 'synthetic', status: 'done' });
    checks.push({ name: '共用待办局部更新', passed: patch.status === 'done' && !('detail' in patch) && !('title' in patch) });
  } catch { checks.push({ name: '共用待办模块', passed: false }); }
  return checks;
}

export function createRecords(storage) {
  return {
    list: () => storage.list(),
    append(input) {
      const { values } = prepareRecordWrite(definition, input);
      if (storage.list().length >= MAX_RECORDS) throw new Error('试验记录已达上限。');
      return storage.append(values);
    },
    update(id, expectedVersion, input) {
      const current = storage.list().find(row => row.id === id);
      if (!current) throw new CollectionError('missing');
      const prepared = prepareRecordWrite(definition, input, { values: current.values, version: current.version, archived: false }, expectedVersion);
      return storage.update(id, expectedVersion, prepared.values);
    },
    toolWrite(key, name, args) {
      const signature = name + ':' + JSON.stringify(args);
      const prior = storage.readReceipt(key, signature);
      if (prior) return prior;
      let operation;
      if (name === 'createCollectionRecord') {
        const prepared = prepareRecordWrite(definition, args.values);
        if (storage.list().length >= MAX_RECORDS) throw new CollectionError('limit');
        operation = { kind: 'create', values: prepared.values };
      } else {
        const current = storage.list().find(row => row.id === args.recordId);
        if (!current) throw new CollectionError('missing');
        const prepared = prepareRecordWrite(definition, args.values, { values: current.values, version: current.version, archived: false }, args.expectedVersion);
        operation = { kind: 'update', id: args.recordId, expectedVersion: args.expectedVersion, values: prepared.values };
      }
      return storage.commitTool(key, signature, operation);
    },
  };
}

function decode(response) {
  const result = JSON.parse(response);
  if (!result.ok && result.code) throw new CollectionError(result.code);
  if (!result.ok) throw new Error(result.error || '本地存储失败。');
  return result.data;
}

export function startPage(document, host) {
  const message = document.getElementById('message');
  const save = document.getElementById('save');
  const bridge = host.SecretaryStorage;
  let editing = null;
  const t = (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
  const showError = error => { message.className = ''; message.textContent = collectionError(error, t) === '操作未完成，请稍后重试。' ? '本地存储不可用，请重试；已填写内容仍保留。' : collectionError(error, t); };
  if (!bridge) { message.textContent = '请在安卓试验应用中打开；普通浏览器没有本机存储接口。'; return; }
  message.textContent = '';
  const records = createRecords({
    list: () => decode(bridge.listRecords()),
    append: values => decode(bridge.appendRecord(JSON.stringify(values))),
    update: (id, version, values) => decode(bridge.updateRecord(id, version, JSON.stringify(values))),
    readReceipt: (key, signature) => decode(bridge.readToolReceipt(key, signature)),
    commitTool: (key, signature, operation) => decode(bridge.commitTool(key, signature, JSON.stringify(operation))),
  });
  const cancel = document.getElementById('cancel-edit');
  function finishEdit() {
    editing = null; document.getElementById('record-form').reset();
    save.textContent = '保存到本机'; cancel.hidden = true;
  }
  function refresh() {
    const rows = records.list();
    const list = document.getElementById('records');
    list.replaceChildren();
    for (const row of rows) {
      const item = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('small');
      title.textContent = prepareRecordWrite(definition, row.values).title;
      detail.textContent = [row.values.status, row.values.date].filter(Boolean).join(' · ');
      const edit = document.createElement('button');
      edit.className = 'secondary'; edit.type = 'button'; edit.textContent = '编辑';
      edit.setAttribute('aria-label', `编辑 ${row.values.name}`);
      edit.addEventListener('click', () => {
        editing = { id: row.id, version: row.version };
        document.getElementById('name').value = row.values.name;
        document.getElementById('date').value = row.values.date || '';
        document.getElementById('status').value = row.values.status;
        save.textContent = '保存修改'; cancel.hidden = false;
        message.className = ''; message.textContent = '正在编辑已保存的记录。';
        document.getElementById('name').focus();
      });
      item.append(title, detail, edit); list.append(item);
    }
    document.getElementById('count').textContent = String(rows.length);
    document.getElementById('empty').hidden = rows.length > 0;
  }
  document.getElementById('record-form').addEventListener('submit', event => {
    event.preventDefault(); save.disabled = true;
    try {
      const values = { name: document.getElementById('name').value, date: document.getElementById('date').value, status: document.getElementById('status').value };
      if (editing) records.update(editing.id, editing.version, values);
      else records.append(values);
      finishEdit();
      message.className = 'success'; message.textContent = '已保存到本机。';
      try { refresh(); }
      catch { message.textContent = '记录已保存，但列表读取失败。请点“重新读取”，无需重复保存。'; }
    } catch (error) { showError(error); }
    finally { save.disabled = false; }
  });
  cancel.addEventListener('click', () => { finishEdit(); message.className = ''; message.textContent = ''; });
  document.getElementById('refresh').addEventListener('click', () => { try { refresh(); save.disabled = false; } catch (error) { showError(error); } });
  document.getElementById('verify').addEventListener('click', () => {
    document.getElementById('checks').textContent = runRuleChecks().map(row => `${row.passed ? '通过' : '失败'}：${row.name}`).join('\n');
  });
  try { refresh(); save.disabled = false; } catch (error) { showError(error); }
  // Debug instrumentation exercises the actual WebView bundle and native SQLite bridge.
  host.Pilot = { runRuleChecks, count: () => records.list().length, list: () => records.list(), append: values => records.append(values), update: (id, version, values) => records.update(id, version, values) };
  const tasks = createTasks({
    list: plan => decode(bridge.listTasks(JSON.stringify(plan))), read: id => decode(bridge.readTask(id)),
    listForView: () => decode(bridge.listTasksForView()),
    setArchived: (id, version, archived) => decode(bridge.setTaskArchived(id, version, archived)),
    deleteArchived: (id, version) => decode(bridge.deleteArchivedTask(id, version)),
    create: data => decode(bridge.createTask(JSON.stringify(data))),
    update: (id, version, patch) => decode(bridge.updateTask(id, version, JSON.stringify(patch))),
    readReceipt: (key, signature) => decode(bridge.readToolReceipt(key, signature)),
    commitTool: (key, signature, operation) => decode(bridge.commitTool(key, signature, JSON.stringify(operation))),
  });
  let selectedTaskId;
  const refreshTasks = attachTaskPanel(document, tasks, {
    read: () => decode(bridge.readOwners()),
    write: names => decode(bridge.writeOwners(JSON.stringify(names))),
  }, id => { selectedTaskId = id; showScreen('/task-detail'); });
  host.Pilot.tasks = tasks;
  const slides = createSlides({
    list: () => decode(bridge.listSlides()), read: id => decode(bridge.readSlide(id)),
    readReceipt: (key, signature) => decode(bridge.readToolReceipt(key, signature)),
    commitTool: (key, signature, operation) => decode(bridge.commitTool(key, signature, JSON.stringify(operation))),
  });
  host.Pilot.slides = slides;
  const navigation = host.PilotMessageUI.createAppShell(document.getElementById('pilot-shell'), document.getElementById('pilot-content-root'), showScreen, topicPlugins);
  navigation.initDrawer();
  const slidePanel = attachSlides(document, host, slides, showScreen);
  const ai = attachAiPanel(document, host, records, definition, () => { refresh(); refreshTasks(); }, tasks, navigation.closeDrawer, value => refreshTasks.setBusy(value), slides,
    link => link.kind === 'slide' && slidePanel.open(link.id));
  const taskChat = attachTaskChat(document, host, tasks, ai, refreshTasks);
  mountTopicPlugins(topicPlugins, { document, host, parent: document.querySelector('#pilot-content-root main') });
  function renderTaskDetail() {
    const task = tasks.readForLifecycle(selectedTaskId);
    if (!task) return false;
    const labels = { todo: '未开始', doing: '进行中', blocked: '卡住了', done: '已完成', cancelled: '已取消' };
    navigation.setTaskTitle(task.title);
    document.getElementById('task-detail-heading').textContent = task.title;
    document.getElementById('task-detail-meta').textContent = [labels[task.status] || task.status, task.category, task.owner || '未指派', task.dueDate ? '截止 ' + String(task.dueDate).slice(0, 10) : '未设截止日', task.archivedAt != null ? '已归档' : ''].filter(Boolean).join(' · ');
    document.getElementById('task-detail-text').textContent = task.detail || '暂无补充要求。';
    document.getElementById('task-detail-result').textContent = task.result || '';
    document.getElementById('task-detail-result-section').hidden = !task.result;
    document.getElementById('task-detail-error').textContent = '';
    document.getElementById('task-discuss').textContent = task.archivedAt != null ? '查看任务对话' : '和 AI 讨论这个任务';
    return true;
  }
  document.getElementById('task-discuss').addEventListener('click', () => {
    if (selectedTaskId && taskChat.open(selectedTaskId)) showScreen('/task-chat');
    else document.getElementById('task-detail-error').textContent = '无法打开任务对话，请重试。';
  });
  function showScreen(path) {
    let target = ['/chat', '/tasks', '/task-detail', '/task-chat', '/slides', '/slides/view', '/collections', '/more', '/settings', '/topics', ...topicPlugins.map(plugin => plugin.path)].includes(path) ? path : '/unavailable';
    if (target === '/task-detail') try { if (!selectedTaskId || !renderTaskDetail()) target = '/tasks'; } catch { target = '/tasks'; }
    if (target === '/task-chat' && !selectedTaskId) target = '/tasks';
    if (target === '/chat') ai.refreshList();
    if (target === '/slides') slidePanel.refresh();
    ai.setScreenActive(target === '/chat');
    for (const section of document.querySelectorAll('[data-screen]')) section.hidden = section.dataset.screen !== target;
    navigation.render(target);
    host.scrollTo(0, 0);
  }
  for (const button of document.querySelectorAll('[data-open-screen]')) button.addEventListener('click', () => showScreen(button.dataset.openScreen));
  showScreen('/chat');
  // The bottom bar and composer can change height with safe areas, text size or
  // a multi-line draft. Reserve exactly their rendered height for scrolling.
  const nav = document.querySelector('#pilot-navigation nav');
  const composer = document.getElementById('ai-form');
  const taskComposer = document.getElementById('task-chat-form');
  const header = document.querySelector('#pilot-page-header header');
  if (host.ResizeObserver && nav && composer && header) {
    const observer = new host.ResizeObserver(() => {
      document.documentElement.style.setProperty('--pilot-nav-height', `${nav.getBoundingClientRect().height}px`);
      document.documentElement.style.setProperty('--pilot-composer-height', `${composer.getBoundingClientRect().height}px`);
      document.documentElement.style.setProperty('--pilot-task-composer-height', `${taskComposer.getBoundingClientRect().height}px`);
      document.documentElement.style.setProperty('--pilot-header-height', `${header.getBoundingClientRect().height}px`);
    });
    observer.observe(nav); observer.observe(composer); observer.observe(taskComposer); observer.observe(header);
  }
}

globalThis.PilotCore = { definition, validateValues, prepareRecordWrite, runRuleChecks, createRecords, createTasks, createSlides, taskPolicy, lifecyclePolicy, projectTaskList, parseOwners, conversation, titleWork, startPage, runPilotAgent, demoModelRequest };
if (typeof document !== 'undefined') startPage(document, globalThis);
