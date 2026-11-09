/** Archiving is independent of the task's workflow status. */
export type TaskLifecycleAction = 'archive' | 'restore' | 'delete';
export type TaskLifecycleRecord = { archivedAt?: Date | string | number | null };

export function assertTaskLifecycle(task: TaskLifecycleRecord, action: TaskLifecycleAction) {
  if (!['archive', 'restore', 'delete'].includes(action)) throw new Error('不支持的任务操作。');
  const archived = task.archivedAt != null;
  if (action === 'archive' && archived) throw new Error('任务已经归档。');
  if (action === 'restore' && !archived) throw new Error('任务尚未归档。');
  if (action === 'delete' && !archived) throw new Error('请先归档，再永久删除。');
}
