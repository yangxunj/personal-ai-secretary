/** 一个页面内只允许一个持续语音会话。快照保持稳定，供 useSyncExternalStore 使用。 */
let session: { owner: object; stop: () => void } | null = null;
const listeners = new Set<() => void>();
export const voiceSessionOwner = () => session?.owner ?? null;
export const serverVoiceSessionOwner = () => null;
export function subscribeVoiceSession(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function beginVoiceSession(owner: object, stop: () => void) {
  session?.stop();
  session = { owner, stop };
  for (const listener of listeners) listener();
}
export function endVoiceSession(owner: object) {
  if (session?.owner !== owner) return;
  session = null;
  for (const listener of listeners) listener();
}
