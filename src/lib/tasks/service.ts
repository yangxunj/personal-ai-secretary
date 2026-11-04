import { prepareTaskCreate, prepareTaskQuery, prepareTaskUpdate, taskPublicDto } from './policy';
import { taskToolContracts } from './contracts';

type MaybePromise<T> = T | PromiseLike<T>;
export type TaskRecord = Parameters<typeof taskPublicDto>[0];
export interface TaskStorage<T extends TaskRecord> {
  list(plan: ReturnType<typeof prepareTaskQuery>): MaybePromise<T[]>;
  read(id: string): MaybePromise<T | null | undefined>;
  create(values: ReturnType<typeof prepareTaskCreate>): MaybePromise<T>;
  update(id: string, before: T, values: ReturnType<typeof prepareTaskUpdate>): MaybePromise<T>;
}

// Native bridges are synchronous; Prisma is asynchronous. Keep the same workflow
// for both, without imposing an event-loop hop on synchronous UI callers.
function map<T, U>(value: MaybePromise<T>, next: (value: T) => MaybePromise<U>): MaybePromise<U> {
  return value != null && typeof (value as PromiseLike<T>).then === 'function'
    ? Promise.resolve(value).then(next) : next(value as T);
}

export class TaskNotFoundError extends Error {
  constructor(id: string) { super(`没有 id 为 ${id} 的任务，先用 listTasks 查一下`); }
}

/** Shared application workflow. Transactions, receipts and concurrency belong to storage adapters. */
export function createTaskService<T extends TaskRecord>(storage: TaskStorage<T>) {
  const list = (input: unknown = {}) => storage.list(prepareTaskQuery(input));
  const create = (input: unknown) => storage.create(prepareTaskCreate(input));
  const update = <U>(input: unknown, missing: (id: string) => U, saved: (row: T) => U): MaybePromise<U> => {
    const args = taskToolContracts.updateTask.inputSchema.parse(input);
    return map(storage.read(args.id), before => {
      if (!before) return missing(args.id);
      return map(storage.update(args.id, before, prepareTaskUpdate(args)), saved);
    });
  };
  return {
    list, create,
    update: (input: unknown) => update(input, id => { throw new TaskNotFoundError(id); }, row => row),
    createTask(input: unknown) {
      const args = taskToolContracts.createTask.inputSchema.parse(input);
      return map(create(args), row => ({ ok: true, id: row.id, title: row.title, dueDate: args.dueDate ?? null, owner: row.owner }));
    },
    listTasks(input: unknown = {}) {
      return map(list(input), rows => ({ count: rows.length, tasks: rows.map(taskPublicDto) }));
    },
    updateTask(input: unknown) {
      // Missing records are a normal tool result; storage failures still propagate.
      return update<{ ok: false; error: string } | { ok: true; id: string; title: string; status: string }>(input,
        id => ({ ok: false, error: new TaskNotFoundError(id).message }),
        row => ({ ok: true, id: row.id, title: row.title, status: row.status }));
    },
  };
}
