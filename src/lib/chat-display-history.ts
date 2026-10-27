import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

/** Display pagination is independent of the harness context/history tools. */
export const displaySelect = {
  id: true, role: true, content: true, createdAt: true,
  attachments: { select: { id: true, filename: true, size: true } },
  task: { select: { id: true, title: true } },
} satisfies Prisma.MessageSelect;
export const displayOrder = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.MessageOrderByWithRelationInput[];
export type DisplayAnchor = { id: string; createdAt: Date };
export function beforeMessage(anchor: DisplayAnchor): Prisma.MessageWhereInput {
  return { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] };
}
export function parseDisplayCursor(raw: string, conversationId: string): DisplayAnchor {
  if (raw.length > 1024) throw new Error('Invalid cursor');
  const c = JSON.parse(raw);
  if (c.v !== 1 || c.conversationId !== conversationId || typeof c.id !== 'string' || !/^[a-z0-9]{1,80}$/.test(c.id)
    || typeof c.createdAt !== 'string' || !Number.isFinite(Date.parse(c.createdAt)) || new Date(c.createdAt).toISOString() !== c.createdAt) throw new Error('Invalid cursor');
  return { id: c.id, createdAt: new Date(c.createdAt) };
}
export async function olderDisplayCount(conversationId: string, first?: DisplayAnchor) {
  return first ? db.message.count({ where: { conversationId, ...beforeMessage(first) } }) : 0;
}
export async function displayPage(conversationId: string, anchor?: DisplayAnchor) {
  const rows = await db.message.findMany({ where: { conversationId, ...(anchor ? beforeMessage(anchor) : {}) },
    orderBy: displayOrder, take: 60, select: displaySelect });
  rows.reverse();
  return { messages: rows, older: await olderDisplayCount(conversationId, rows[0]) };
}
