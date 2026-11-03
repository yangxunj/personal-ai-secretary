import { OPEN_TASK_STATUSES, taskToolContracts } from './contracts';

// Keep the existing general-chat date semantics. Task-scoped chat has its own
// stricter calendar/timezone contract and remains in task-chat-scope.mjs.
function date(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid task due date.');
  return parsed;
}
export function prepareTaskCreate(input: unknown) {
  const args = taskToolContracts.createTask.inputSchema.parse(input);
  return { title: args.title, detail: args.detail ?? null, category: args.category ?? '其他', priority: args.priority ?? 2,
    dueDate: args.dueDate ? date(args.dueDate) : null, owner: args.owner?.trim() || null, status: 'todo', result: null };
}
export function prepareTaskUpdate(input: unknown) {
  const { id: _id, dueDate, owner, ...rest } = taskToolContracts.updateTask.inputSchema.parse(input);
  return { ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
    ...(dueDate ? { dueDate: date(dueDate) } : {}), ...(owner !== undefined ? { owner: owner.trim() || null } : {}) };
}
export function prepareTaskQuery(input: unknown = {}) {
  const args = taskToolContracts.listTasks.inputSchema.parse(input);
  return { statuses: args.status ? [args.status] : [...OPEN_TASK_STATUSES], category: args.category ?? null, keyword: args.keyword || null, limit: args.limit ?? 20 };
}
export function taskPublicDto(task: { id: string; title: string; detail: string | null; status: string; category: string; priority: number; dueDate: Date | string | null; result: string | null; owner: string | null }) {
  return { id: task.id, title: task.title, detail: task.detail, status: task.status, category: task.category, priority: task.priority,
    dueDate: task.dueDate ? (task.dueDate instanceof Date ? task.dueDate : new Date(task.dueDate)).toISOString().slice(0, 10) : null, result: task.result, owner: task.owner };
}
