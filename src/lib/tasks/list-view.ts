import { OPEN_TASK_STATUSES, TASK_CATEGORIES } from './contracts';

export const TASK_GROUP_ORDER = ['doing', 'blocked', 'todo', 'done', 'cancelled'] as const;
export const TASK_VIEW_STATUSES = ['all', 'open', 'overdue', 'done', 'cancelled'] as const;
export type TaskViewStatus = typeof TASK_VIEW_STATUSES[number] | 'todo' | 'doing' | 'blocked';
export type ListTask = { id: string; status: string; category: string; owner: string | null; dueDate: Date | string | null; createdAt: Date | string | number };

export function startOfToday(now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0); return today;
}
export function overdueDays(due: Date | string | null, today: Date) {
  if (!due) return 0;
  const diff = today.getTime() - new Date(due).setHours(0, 0, 0, 0);
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0;
}
export function matchTaskStatus(task: Pick<ListTask, 'status' | 'dueDate'>, key: TaskViewStatus, today: Date) {
  if (key === 'all') return true;
  const open = (OPEN_TASK_STATUSES as readonly string[]).includes(task.status);
  if (key === 'open') return open;
  if (key === 'overdue') return open && overdueDays(task.dueDate, today) > 0;
  return task.status === key;
}

/** Apply the same cross-filter counts and ordering to full platform snapshots. */
export function projectTaskList<T extends ListTask>(all: T[], filters: { status?: string; category?: string; owner?: string } = {}, members: string[] = [], now = new Date()) {
  const today = startOfToday(now);
  const valid = [...TASK_VIEW_STATUSES, 'todo', 'doing', 'blocked'];
  const status = (valid.includes(filters.status ?? '') ? filters.status : 'open') as TaskViewStatus;
  const cat = filters.category && all.some(task => task.category === filters.category) ? filters.category : undefined;
  const owners = [...new Set([...members, ...all.map(task => task.owner).filter((owner): owner is string => !!owner)])];
  const own = filters.owner === 'none' || (filters.owner && owners.includes(filters.owner)) ? filters.owner : undefined;
  const matchOwner = (task: T) => !own || (own === 'none' ? !task.owner : task.owner === own);
  const matchCat = (task: T) => !cat || task.category === cat;
  const byStatus = all.filter(task => matchTaskStatus(task, status, today) && matchOwner(task));
  const byCat = all.filter(task => matchCat(task) && matchOwner(task));
  const byOwnerRow = all.filter(task => matchTaskStatus(task, status, today) && matchCat(task));
  const tasks = byStatus.filter(matchCat);
  const counts = new Map<string, number>();
  for (const task of all) counts.set(task.category, 0);
  for (const task of byStatus) counts.set(task.category, (counts.get(task.category) ?? 0) + 1);
  const cats = [...counts.keys()].sort((a, b) => {
    const ia = (TASK_CATEGORIES as readonly string[]).indexOf(a), ib = (TASK_CATEGORIES as readonly string[]).indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  const statusCounts = new Map<TaskViewStatus, number>([...TASK_VIEW_STATUSES, 'todo', 'doing', 'blocked'].map(key =>
    [key as TaskViewStatus, byCat.filter(task => matchTaskStatus(task, key as TaskViewStatus, today)).length]));
  const ownerCounts = new Map<string, number>([['none', byOwnerRow.filter(task => !task.owner).length], ...owners.map(name => [name, byOwnerRow.filter(task => task.owner === name).length] as [string, number])]);
  const sorted = [...tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const groups = TASK_GROUP_ORDER.map(key => ({ status: key, items: sorted.filter(task => task.status === key) })).filter(group => group.items.length > 0);
  return { today, status, cat, own, owners, tasks, byStatus, byOwnerRow, counts, cats, statusCounts, ownerCounts, groups,
    overdueCount: all.filter(task => matchTaskStatus(task, 'overdue', today)).length };
}
