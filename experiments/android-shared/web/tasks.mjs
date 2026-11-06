import { createTaskService } from '../../../src/lib/tasks/service.ts';
import { prepareTaskCreate, prepareTaskUpdate, prepareTaskQuery, taskPublicDto } from '../../../src/lib/tasks/policy.ts';
import { projectTaskList } from '../../../src/lib/tasks/list-view.ts';
export const taskPolicy = { prepareTaskCreate, prepareTaskUpdate, prepareTaskQuery, taskPublicDto };
export { projectTaskList };

export function createTasks(storage) {
  const adapter = {
    ...storage,
    update: (id, before, values) => storage.update(id, before.version, values),
  };
  const service = createTaskService(adapter);
  return {
    ...service,
    listForView: filters => projectTaskList(storage.listForView(), filters),
    toolWrite(key, name, args) {
      if (name !== 'createTask' && name !== 'updateTask') throw new Error('Unknown task write: ' + name);
      const signature = name + ':' + JSON.stringify(args);
      // Native commitTool retains atomic task/receipt writes and version checks.
      // Replays pass through the same shared tool-result projection.
      const prior = storage.readReceipt(key, signature);
      const write = operation => prior || storage.commitTool(key, signature, operation);
      const toolService = createTaskService({
        ...adapter,
        read: id => prior || storage.read(id),
        create: values => write({ kind: 'task-create', values }),
        update: (id, before, values) => write({ kind: 'task-update', id, expectedVersion: before.version, values }),
      });
      return toolService[name](args);
    },
  };
}

const labels = { todo: '待办', doing: '进行中', blocked: '卡住了', done: '已完成', cancelled: '已取消' };
export function attachTaskPanel(document, tasks) {
  const form = document.getElementById('task-form'), message = document.getElementById('task-message'), filter = document.getElementById('task-filter');
  const category = document.getElementById('task-category'), owner = document.getElementById('task-owner');
  const cards = globalThis.PilotMessageUI.createTaskCards(document.getElementById('tasks'), (id, patch) => {
    try { tasks.update({ id, ...patch }); }
    catch { message.textContent = '更新失败，请重读后再试。'; return; }
    try { refresh(); message.textContent = '已更新待办。'; }
    catch { message.textContent = '待办已更新，但列表重读失败；请重读。'; }
  });
  function refresh() {
    const view = tasks.listForView({ status: filter.value || 'open', category: category.value, owner: owner.value });
    const rows = view.groups.flatMap(group => group.items);
    const setOptions = (select, entries, selected) => {
      select.replaceChildren();
      for (const [value, label] of entries) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
      select.value = selected || '';
    };
    const statusOptions = [['', '未完成', 'open'], ['all', '全部状态', 'all'], ['overdue', '已逾期', 'overdue'],
      ...['todo', 'doing', 'blocked', 'done', 'cancelled'].map(key => [key, labels[key], key])];
    setOptions(filter, statusOptions.map(([value, label, key]) => [value, `${label} (${view.statusCounts.get(key)})`]), view.status === 'open' ? '' : view.status);
    setOptions(category, [['', `全部分类 (${view.byStatus.length})`], ...view.cats.map(name => [name, `${name} (${view.counts.get(name)})`])], view.cat);
    setOptions(owner, [['', `全部负责人 (${view.byOwnerRow.length})`], ['none', `未指派 (${view.ownerCounts.get('none')})`], ...view.owners.map(name => [name, `${name} (${view.ownerCounts.get(name)})`])], view.own);
    cards.render(view.groups.map(group => ({ ...group, items: group.items.map(taskPublicDto) })), [...new Set(['我', ...view.owners])]);
    document.getElementById('task-count').textContent = String(rows.length);
    document.getElementById('tasks-empty').hidden = rows.length > 0;
  }
  filter.addEventListener('change', () => { try { refresh(); } catch { message.textContent = '任务读取失败。'; } });
  category.addEventListener('change', () => { try { refresh(); } catch { message.textContent = '任务读取失败。'; } });
  owner.addEventListener('change', () => { try { refresh(); } catch { message.textContent = '任务读取失败。'; } });
  document.getElementById('task-refresh').addEventListener('click', () => { try { refresh(); } catch { message.textContent = '任务读取失败。'; } });
  form.addEventListener('submit', event => {
    event.preventDefault(); const save = document.getElementById('task-save'); save.disabled = true;
    try {
      const title = document.getElementById('task-title').value.trim(); if (!title) throw new Error('请填写标题');
      tasks.create({ title, detail: document.getElementById('task-detail').value || undefined, dueDate: document.getElementById('task-due').value || undefined });
      form.reset(); message.textContent = '已保存待办。';
      try { refresh(); } catch { message.textContent = '待办已保存，但列表重读失败；请重读，不要重复保存。'; }
    } catch { message.textContent = '保存失败，请检查输入；草稿仍保留。'; }
    finally { save.disabled = false; }
  });
  try { refresh(); } catch { message.textContent = '任务读取失败，请重试。'; }
  return refresh;
}
