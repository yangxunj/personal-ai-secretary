import { db } from '@/lib/db';
import { runChat } from '@/lib/chat-agent';
import type { T, Locale } from '@/lib/i18n/core';
import type { VoiceJob } from '@prisma/client';

import { jobState as state, recoverVoiceJobs } from './job-state';
export { recoverVoiceJobs } from './job-state';

/** 消费原有 UI 流，真正执行和持久化仍归现有 API/Codex Agent 所有。 */
export async function consumeAgentResponse(response: Response): Promise<string> {
  if (!response.ok || !response.body) throw new Error('Agent request failed');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', text = '', finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n'); pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ') || line.slice(6).trim() === '[DONE]') continue;
        const item = JSON.parse(line.slice(6));
        if (item.type === 'error' || item.type === 'abort') throw new Error('Agent did not finish');
        if (item.type === 'text-delta') text += item.delta || '';
        if (item.type === 'finish') {
          if (['error', 'length', 'content-filter'].includes(item.finishReason)) throw new Error('Agent did not finish');
          finished = true;
        }
      }
      if (done) break;
    }
  } finally { reader.releaseLock(); }
  if (!finished || !text.trim()) throw new Error('Agent returned no final answer');
  return text.trim();
}

export async function submitVoiceJob(input: {
  conversationId: string; taskId: string | null; requestKey: string; transcript: string; objective: string; locale: Locale; t: T;
}, completed: (job: VoiceJob) => void) {
  await recoverVoiceJobs();
  const previous = await db.voiceJob.findUnique({ where: { requestKey: input.requestKey } });
  if (previous) return previous;
  if (await db.voiceJob.count({ where: { conversationId: input.conversationId, status: { in: ['queued', 'running'] } } }) >= 5) throw new Error('Queue full');
  // 唯一键抵御模型重复调用和并发请求，不在网络异常后重放操作。
  let job: VoiceJob;
  try {
    job = await db.voiceJob.create({ data: { conversationId: input.conversationId, requestKey: input.requestKey,
      transcript: input.transcript, objective: input.objective, processKey: state.processKey } });
  } catch (error) {
    const duplicate = await db.voiceJob.findUnique({ where: { requestKey: input.requestKey } });
    if (duplicate) return duplicate;
    throw error;
  }
  const accepted = job;
  const work = (state.tails.get(input.conversationId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    try {
      await db.voiceJob.update({ where: { id: accepted.id }, data: { status: 'running' } });
      const response = await runChat(new Request('http://internal/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: input.conversationId, ...(input.taskId ? { taskId: input.taskId } : {}),
          message: { id: `voice_${accepted.id}`, role: 'user', parts: [{ type: 'text', text:
            `用户语音原文：\n${input.transcript}\n\n对当前指代的补充理解（只供参考，以原文及用户明确约束为准，不增加操作）：\n${input.objective}` }] } }) }),
      { locale: input.locale, t: input.t, displayText: input.transcript });
      const result = await consumeAgentResponse(response);
      const saved = await db.voiceJob.update({ where: { id: accepted.id }, data: { status: 'completed', result } });
      try { completed(saved); } catch { /* 展示失败不能改写已完成的执行结果。 */ }
    } catch {
      const saved = await db.voiceJob.update({ where: { id: accepted.id }, data: { status: 'failed', error: '后台处理未完成，部分操作可能已保存，请查看聊天记录，不要重复提交。' } });
      try { completed(saved); } catch { /* 回执仍在数据库中，可由后续会话恢复。 */ }
    }
  });
  state.tails.set(input.conversationId, work);
  void work.finally(() => { if (state.tails.get(input.conversationId) === work) state.tails.delete(input.conversationId); }).catch(() => {});
  return job;
}

export async function voiceJobStatus(conversationId: string) {
  await recoverVoiceJobs();
  return db.voiceJob.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take: 8,
    select: { id: true, status: true, transcript: true, result: true, error: true, announcedAt: true } });
}
