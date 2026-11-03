// Conservative preflight shared by the Node runtime and browser Pi adapter.
// This is an estimate, not provider billing or automatic compaction.
export function estimateContextTokens(value) {
  const s = JSON.stringify(value); let wide = 0;
  for (const ch of s) if (/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/u.test(ch)) wide++;
  return wide + Math.ceil((s.length - wide) / 3);
}
