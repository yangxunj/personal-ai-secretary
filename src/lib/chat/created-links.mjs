/** Internal actions are derived only from successful persisted tool results. */
export function createdLinks(turn) {
  if (!turn || turn.status === 'running' || !Array.isArray(turn.messages)) return [];
  const seen = new Set(), links = [];
  for (const message of turn.messages) {
    if (message?.role !== 'toolResult' || message.toolName !== 'createSlideDeck' || message.isError !== false || !Array.isArray(message.content)) continue;
    for (const item of message.content) {
      if (item?.type !== 'text' || typeof item.text !== 'string' || item.text.length > 2000) continue;
      try {
        const result = JSON.parse(item.text), deck = result?.deck;
        if (result?.ok !== true || typeof deck?.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deck.id)
            || typeof deck.title !== 'string' || !deck.title.trim() || deck.title.length > 100 || seen.has(deck.id)) continue;
        seen.add(deck.id); links.push({ kind: 'slide', id: deck.id, title: deck.title.trim() });
      } catch { /* Ignore malformed or unrelated historical tool messages. */ }
    }
  }
  return links;
}
