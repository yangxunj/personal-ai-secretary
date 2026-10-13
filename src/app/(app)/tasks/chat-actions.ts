'use server';

import { db } from '@/lib/db';
import { sessionIsCurrent } from '@/lib/auth';
import { getChatBackend } from '@/lib/codex/config';
import { recoverCodexTurns } from '@/lib/codex/chat';
import { getT } from '@/lib/i18n/server';

/** Only called after the user opens the panel; hidden task lists create no chats. */
export async function loadTaskChat(taskId: string, take = 60) {
  if (!(await sessionIsCurrent())) throw new Error('Unauthorized');
  const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true, title: true } });
  if (!task) throw new Error('Task not found');
  const t = await getT();
  const conversation = await db.conversation.upsert({
    where: { taskId }, update: {},
    create: { taskId, backend: await getChatBackend(), title: t('任务：{title}', { title: task.title }) },
  });
  if (conversation.backend === 'codex') await recoverCodexTurns();
  const limit = Math.min(2000, Math.max(60, Math.floor(Number(take) || 60)));
  const where = { conversationId: conversation.id };
  const [rows, count, turn] = await Promise.all([
    db.message.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit,
      include: { attachments: { select: { id: true, filename: true, size: true } } } }),
    db.message.count({ where }),
    conversation.backend === 'codex' ? db.codexTurn.findFirst({ where, orderBy: { createdAt: 'desc' } }) : null,
  ]);
  return { id: conversation.id, backend: conversation.backend,
    pending: !!turn && ['queued', 'running'].includes(turn.status),
    lastError: turn?.status === 'failed' ? turn.error || '' : '',
    older: Math.max(0, count - rows.length),
    history: rows.reverse().map(m => ({ id: m.id, role: m.role, content: m.content,
      createdAt: m.createdAt.toISOString(), attachments: m.attachments })),
  };
}
