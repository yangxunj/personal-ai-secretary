import { z } from 'zod';

export const TASK_CATEGORIES = ['健康', '保险', '出行', '教育', '财务', '证件', '居家', '其他'] as const;
export const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done', 'cancelled'] as const;
export const OPEN_TASK_STATUSES = ['todo', 'doing', 'blocked'] as const;

/** Existing general-chat contracts, shared without changing the task-scoped policy. */
export const taskToolContracts = {
  createTask: {
    description: '建一条待办。用户说「记一下」「别忘了」「下周要…」这类需要以后跟进的事就用它。只是想聊天或问问题不要建。',
    inputSchema: z.object({
      title: z.string().describe('一句话说清要做什么，别写成长段落'),
      detail: z.string().optional().describe('补充说明：背景、具体要求、注意事项'),
      category: z.enum(TASK_CATEGORIES).optional().describe('不确定就别填，默认「其他」'),
      priority: z.number().int().min(1).max(3).optional().describe('1=高 2=中 3=低，默认 2'),
      dueDate: z.string().optional().describe('截止日期，格式 2026-09-30。没有明确期限就别填'),
      owner: z.string().optional().describe('谁来办。从系统提示里「家里的人」中选；用户没说是谁的事就别填'),
    }),
  },
  listTasks: {
    description: '查待办。用户问「还有什么没做」「这周要干嘛」「那件事怎么样了」时用。默认只看没完成的。',
    inputSchema: z.object({
      status: z.enum(TASK_STATUSES).optional().describe('不填 = 所有未完成的（todo/doing/blocked）'),
      category: z.enum(TASK_CATEGORIES).optional(), keyword: z.string().optional().describe('按标题模糊搜'),
      limit: z.number().int().min(1).max(50).optional(),
    }),
  },
  updateTask: {
    description: '改一条待办：标记完成、改状态、补充处理结果。**先用 listTasks 拿到 id**，不要凭印象编 id。',
    inputSchema: z.object({
      id: z.string().describe('任务 id，从 listTasks 的结果里取'), status: z.enum(TASK_STATUSES).optional(),
      result: z.string().optional().describe('处理结果 / 交付说明'), title: z.string().optional(), detail: z.string().optional(),
      priority: z.number().int().min(1).max(3).optional(), dueDate: z.string().optional().describe('格式 2026-09-30'),
      owner: z.string().optional().describe('改派给谁（「家里的人」里选）；传空字符串 = 取消指派'),
    }),
  },
};
