import { z } from 'zod';

const key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const messageSchema = z.looseObject({
  role: z.enum(['user', 'assistant', 'toolResult']),
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
});
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), id: key, mode: z.enum(['deepseek', 'demo']),
  title: z.string().max(80), draft: z.string().max(1000),
  turns: z.array(z.object({
    id: key, prompt: z.string().min(1).max(1000),
    status: z.enum(['running', 'complete', 'interrupted']),
    reply: z.string(), messages: z.array(messageSchema).max(40),
  }).strict()).max(40),
}).strict();

export const interruptedNotice = '该轮未完整结束；已提交的工具结果可能仍在。请先查询核对，不要自动重做或重新执行上一轮写入。';
export function parseConversation(value) {
  const snapshot = snapshotSchema.parse(value);
  if (JSON.stringify(snapshot).length > 240000) throw new Error('对话记录过大，请新建对话。');
  const ids = snapshot.turns.map(turn => turn.id);
  if (new Set(ids).size !== ids.length) throw new Error('重复的对话轮次。');
  if (snapshot.turns.some((turn, i) => turn.status === 'running' && i !== snapshot.turns.length - 1)) throw new Error('无效的对话状态。');
  return snapshot;
}
export function newConversation(id, mode) {
  return parseConversation({ schemaVersion: 1, id, mode, title: '新对话', draft: '', turns: [] });
}
export function conversationHistory(value) {
  const snapshot = parseConversation(value);
  return snapshot.turns.flatMap(turn => turn.status === 'complete' ? turn.messages : [
    { role: 'user', content: turn.prompt, timestamp: 0 },
    { role: 'assistant', content: [{ type: 'text', text: interruptedNotice }], timestamp: 0 },
  ]);
}
export function recoverConversation(value) {
  const snapshot = parseConversation(value);
  for (const turn of snapshot.turns) if (turn.status === 'running') { turn.status = 'interrupted'; turn.reply = interruptedNotice; }
  return snapshot;
}
export function beginConversationTurn(value, id, prompt) {
  const snapshot = parseConversation(value);
  if (snapshot.turns.some(turn => turn.status === 'running')) throw new Error('已有请求正在进行。');
  if (snapshot.turns.length >= 40) throw new Error('当前对话已达 40 轮，请新建对话。');
  const next = { ...snapshot, title: snapshot.turns.length ? snapshot.title : prompt.slice(0, 40), draft: prompt,
    turns: [...snapshot.turns, { id, prompt, status: 'running', reply: '', messages: [] }] };
  return parseConversation(next);
}
export function recordConversationMessage(value, message) {
  const snapshot = parseConversation(value);
  if (message.role === 'system') return snapshot; // Current tools/instructions are redeclared for every run.
  const turn = snapshot.turns.at(-1);
  if (!turn || turn.status !== 'running') throw new Error('没有正在进行的轮次。');
  turn.messages.push(messageSchema.parse(message));
  return parseConversation(snapshot);
}
export function finishConversationTurn(value, reply, complete) {
  const snapshot = parseConversation(value), turn = snapshot.turns.at(-1);
  if (!turn || turn.status !== 'running') throw new Error('没有正在进行的轮次。');
  turn.status = complete ? 'complete' : 'interrupted'; turn.reply = reply;
  if (complete) snapshot.draft = '';
  return parseConversation(snapshot);
}
