import { prepareTaskCreate, prepareTaskUpdate, prepareTaskQuery, taskPublicDto } from '../../../src/lib/tasks/policy.ts';
import { TASK_STATUSES } from '../../../src/lib/tasks/contracts.ts';
export const taskPolicy = { prepareTaskCreate, prepareTaskUpdate, prepareTaskQuery, taskPublicDto };

export function createTasks(storage) {
  const current = id => { const task = storage.read(id); if (!task) throw new Error('任务不存在，请重新查询。'); return task; };
  return {
    list: input => storage.list(prepareTaskQuery(input || {})),
    create: input => storage.create(prepareTaskCreate(input)),
    update(input) { const before = current(input.id); return storage.update(input.id, before.version, prepareTaskUpdate(input)); },
    toolWrite(key, name, args) {
      const signature = name + ':' + JSON.stringify(args);
      const prior = storage.readReceipt(key, signature); if (prior) return prior;
      let operation;
      if (name === 'createTask') operation = { kind: 'task-create', values: prepareTaskCreate(args) };
      else { const before = current(args.id); operation = { kind: 'task-update', id: args.id, expectedVersion: before.version, values: prepareTaskUpdate(args) }; }
      return storage.commitTool(key, signature, operation);
    },
  };
}

const labels = { todo: '待办', doing: '进行中', blocked: '卡住了', done: '已完成', cancelled: '已取消' };
export function attachTaskPanel(document, tasks) {
  const form = document.getElementById('task-form'), message = document.getElementById('task-message'), filter = document.getElementById('task-filter');
  for (const status of TASK_STATUSES) { const option = document.createElement('option'); option.value = status; option.textContent = labels[status]; filter.append(option); }
  function refresh() {
    const rows = tasks.list({ ...(filter.value ? { status: filter.value } : {}), limit: 50 });
    const list = document.getElementById('tasks'); list.replaceChildren();
    for (const row of rows) {
      const task = taskPublicDto(row), item = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('small');
      title.textContent = task.title;
      detail.textContent = [labels[task.status] || task.status, task.category, '优先级' + ({ 1: '高', 2: '中', 3: '低' }[task.priority] || task.priority), task.dueDate ? '截止 ' + task.dueDate : '未设截止日', task.owner || '未指派'].join(' · ');
      item.append(title, detail);
      if (task.detail) { const requirement = document.createElement('p'); requirement.textContent = task.detail; item.append(requirement); }
      if (task.result) { const result = document.createElement('p'); result.textContent = '处理结果：' + task.result; item.append(result); }
      if (task.status !== 'done' && task.status !== 'cancelled') {
        const done = document.createElement('button'); done.type = 'button'; done.className = 'secondary'; done.textContent = '标记完成'; done.setAttribute('aria-label', '完成 ' + task.title);
        done.addEventListener('click', () => { try { tasks.update({ id: task.id, status: 'done' }); refresh(); message.textContent = '已完成；可切换到“已完成”查看。'; } catch { message.textContent = '更新失败，请重读后再试。'; } });
        item.append(done);
      }
      list.append(item);
    }
    document.getElementById('task-count').textContent = String(rows.length);
    document.getElementById('tasks-empty').hidden = rows.length > 0;
  }
  filter.addEventListener('change', () => { try { refresh(); } catch { message.textContent = '任务读取失败。'; } });
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
