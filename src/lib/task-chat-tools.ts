import { tool } from 'ai';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { db, withDatabaseTransaction } from '@/lib/db';
import { buildAgentTools, type ToolContext } from '@/lib/agent-tools';
import { taskChatContext } from '@/lib/task-chat-context';
import { taskPatch } from '@/lib/task-chat-scope.mjs';
import { makeT } from '@/lib/i18n/core';

/** The scope is supplied from the persisted Conversation, never from the model. */
export function buildChatTools(ctx: ToolContext & { taskId?: string | null }) {
  const base = buildAgentTools(ctx), taskId = ctx.taskId;
  if (!taskId) return base;
  const t = ctx.t || makeT(null);
  return {
    createTask: tool({
      description: '按用户要求创建后续待办，自动关联当前任务为前置任务。普通讨论不创建待办。',
      inputSchema: base.createTask.inputSchema,
      execute: async (args, options) => withDatabaseTransaction(async () => {
        await db.task.findUniqueOrThrow({ where: { id: taskId }, select: { id: true } });
        const result = await base.createTask.execute!(args, options);
        if (!('ok' in result)) throw new Error('Unexpected streaming task output');
        if (result.ok) await db.task.update({ where: { id: result.id }, data: { blocksOn: taskId } });
        return result;
      }),
    }),
    listTasks: tool({
      description: '读取当前任务最新要求、状态、进展、文稿、专题、前置/后续任务及附件元数据。不会列出其他无关任务。',
      inputSchema: base.listTasks.inputSchema,
      execute: async () => ({ count: 1, tasks: [await taskChatContext(taskId)] }),
    }),
    updateTask: tool({
      description: '只能修改当前任务。不得覆盖最初要求 detail；新要求或结论用 saveNote。成功修改会另外保留一条任务进展。',
      inputSchema: z.object({
        id: z.string(), title: z.string().trim().min(1).max(200).optional(),
        status: z.enum(['todo', 'doing', 'blocked', 'done', 'cancelled']).optional(),
        result: z.string().optional(), priority: z.number().int().min(1).max(3).optional(),
        dueDate: z.string().optional().describe('YYYY-MM-DD；空字符串清除日期'),
        owner: z.string().optional(),
      }).strict(),
      execute: async args => withDatabaseTransaction(async () => {
        const patch = taskPatch(taskId, args);
        const before = await db.task.findUniqueOrThrow({ where: { id: taskId } });
        const after = await db.task.update({ where: { id: taskId }, data: patch });
        const labels: Record<string, string> = { title: t('标题'), status: t('状态'), result: t('处理结果'),
          priority: t('优先级'), dueDate: t('截止日期'), owner: t('负责人') };
        const fields = Object.keys(patch).filter(k => String(before[k as keyof typeof before]) !== String(after[k as keyof typeof after])).map(k => labels[k]).join(t('、'));
        if (fields) await db.message.create({ data: { role: 'secretary', status: 'unread', taskId,
          content: t('AI 已更新：{fields}', { fields }) + (args.result ? '\n\n' + args.result : '') } });
        revalidatePath('/tasks'); revalidatePath('/tasks/' + taskId);
        return { ok: true, id: after.id, title: after.title, status: after.status, result: after.result };
      }),
    }),
    saveNote: tool({
      description: '按用户要求把新要求、整理的结论或进展追加到当前任务经过，不覆盖最初要求。普通聊天已有独立记录，不必重复留档。',
      inputSchema: base.saveNote.inputSchema,
      execute: async ({ content }) => {
        const note = await db.message.create({ data: { role: 'secretary', content, status: 'unread', taskId } });
        revalidatePath('/tasks/' + taskId); return { ok: true, id: note.id };
      },
    }),
    saveFile: tool({
      description: '把本轮上传的文件归档并关联当前任务。其他业务模块的导入请在通用对话操作。',
      inputSchema: base.saveFile.inputSchema,
      execute: async (args, options) => withDatabaseTransaction(async () => {
        const result = await base.saveFile.execute!(args, options);
        if (!('ok' in result)) throw new Error('Unexpected streaming file output');
        if (result.ok && 'files' in result) await db.attachment.updateMany({ where: { id: { in: result.files!.map(f => f.id) } }, data: { taskId } });
        revalidatePath('/tasks/' + taskId); return result;
      }),
    }),
  };
}
