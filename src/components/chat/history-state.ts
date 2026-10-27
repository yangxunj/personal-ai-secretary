import type { SeedMessage } from '@/components/Chat';

export function displayCursor(conversationId: string, first: SeedMessage) {
  return JSON.stringify({ v: 1, conversationId, id: first.id, createdAt: first.createdAt });
}
export function mergeDisplayMessages(previous: SeedMessage[], incoming: SeedMessage[]) {
  const byId = new Map(previous.map(m => [m.id, m]));
  for (const message of incoming) {
    const old = byId.get(message.id);
    byId.set(message.id, old && JSON.stringify(old) === JSON.stringify(message) ? old : message);
  }
  const rows = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows.length === previous.length && rows.every((m, i) => m === previous[i]) ? previous : rows;
}
