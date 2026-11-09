import { z } from 'zod';
import { TASK_STATUSES } from './contracts';

/** Task-chat updates never include the original task requirements. */
export const scopedTaskUpdate = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  result: z.string().optional(), priority: z.number().int().min(1).max(3).optional(),
  dueDate: z.string().optional().describe('YYYY-MM-DD；空字符串清除日期'),
  owner: z.string().optional(),
}).strict();

// The web model identifies the current task; Android binds the ID in the host.
export const scopedTaskUpdateWithId = scopedTaskUpdate.extend({ id: z.string() });
