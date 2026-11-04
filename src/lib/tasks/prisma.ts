import { db } from '../db';
import { createTaskService } from './service';

// Use the transaction-aware db proxy: callers inside an agent turn must keep
// business writes and their audit/receipt in the caller's existing transaction.
export const taskService = createTaskService({
  create: data => db.task.create({ data }),
  read: id => db.task.findUnique({ where: { id } }),
  update: (id, _before, data) => db.task.update({ where: { id }, data }),
  list: plan => db.task.findMany({
    where: {
      status: { in: plan.statuses },
      ...(plan.category ? { category: plan.category } : {}),
      ...(plan.keyword ? { title: { contains: plan.keyword } } : {}),
    },
    orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
    take: plan.limit,
  }),
});
