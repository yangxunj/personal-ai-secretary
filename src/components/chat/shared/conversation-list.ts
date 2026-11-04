export type ConversationListItem = { id: string; title: string; updatedAt: string; provisional?: boolean };

/** Preserve the current product's local-date buckets and incoming item order. */
export function groupConversationItems(items: ConversationListItem[], t: (key: string) => string, now = new Date()): [string, ConversationListItem[]][] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  const buckets: [string, (timestamp: number) => boolean][] = [
    [t('今天'), ts => ts >= today], [t('昨天'), ts => ts >= today - DAY],
    [t('7 天内'), ts => ts >= today - 6 * DAY], [t('30 天内'), ts => ts >= today - 29 * DAY],
    [t('更早'), () => true],
  ];
  const out = new Map<string, ConversationListItem[]>();
  for (const item of items) {
    const label = buckets.find(([, matches]) => matches(new Date(item.updatedAt).getTime()))![0];
    out.set(label, [...(out.get(label) ?? []), item]);
  }
  return buckets.map(([label]) => label).filter(label => out.has(label)).map(label => [label, out.get(label)!]);
}
