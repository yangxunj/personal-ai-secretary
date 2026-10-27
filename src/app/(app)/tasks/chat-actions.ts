'use server';

import { db } from '@/lib/db';
import { sessionIsCurrent } from '@/lib/auth';
import { getChatBackend } from '@/lib/codex/config';
import { recoverCodexTurns } from '@/lib/codex/chat';
import { getT } from '@/lib/i18n/server';
import { displayPage } from '@/lib/chat-display-history';

/** Only called after the user opens the panel; hidden task lists create no chats. */
export async function loadTaskChat(taskId: string) {
  if (!(await sessionIsCurrent())) throw new Error('Unauthorized');
  const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true, title: true } });
  if (!task) throw new Error('Task not found');
  const t = await getT();
  const conversation = await db.conversation.upsert({
    where: { taskId }, update: {},
    create: { taskId, backend: await getChatBackend(), title: t('任务：{title}', { title: task.title }) },
  });
  if (['codex','pi'].includes(conversation.backend)) await recoverCodexTurns();
  const where = { conversationId: conversation.id };
  const [page, turn] = await Promise.all([
    displayPage(conversation.id),
    ['codex','pi'].includes(conversation.backend) ? db.codexTurn.findFirst({ where, orderBy: { createdAt: 'desc' } }) : null,
  ]);
  return { id: conversation.id, backend: conversation.backend,
    pending: !!turn && ['queued', 'running'].includes(turn.status),
    lastError: turn?.status === 'failed' ? turn.error || '' : '',
    older: page.older,
    history: page.messages.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })),
  };
}
