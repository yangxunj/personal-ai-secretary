export function taskPatch(taskId, args) {
  if (args.id !== taskId) throw new Error('Only the current task can be changed.');
  if ('detail' in args) throw new Error('The original task requirements cannot be overwritten.');
  const patch = {};
  for (const key of ['title', 'status', 'result', 'priority']) if (args[key] !== undefined) patch[key] = args[key];
  if (args.owner !== undefined) patch.owner = args.owner.trim() || null;
  if (args.dueDate !== undefined) {
    if (args.dueDate === '') patch.dueDate = null;
    else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dueDate)) throw new Error('Invalid due date.');
      const date = new Date(args.dueDate + 'T00:00:00+08:00');
      if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10) !== args.dueDate) throw new Error('Invalid due date.');
      patch.dueDate = date;
    }
  }
  if (!Object.keys(patch).length) throw new Error('No task changes were specified.');
  return patch;
}
