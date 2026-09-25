export const TOPIC_STATUS: Record<string, string> = {
  active: '在进行',
  settled: '有结论',
  parked: '搁置',
};

export type TopicQuestion = { q: string; note?: string; done?: boolean };

/**
 * questions 存的是 JSON 数组（跟 VaultItem.fields 一个路子）。
 * 坏了或空着都当空数组，别让一条脏数据把整个页面渲染挂掉。
 */
export function parseQuestions(raw: string | null | undefined): TopicQuestion[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as TopicQuestion[]) : [];
  } catch {
    return [];
  }
}
