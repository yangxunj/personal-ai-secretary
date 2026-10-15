import { db } from '@/lib/db';

type JobsState = { processKey: string; recovery?: Promise<unknown>; tails: Map<string, Promise<unknown>> };
const globalJobs = globalThis as unknown as { secretaryVoiceJobs?: JobsState };
export const jobState: JobsState = globalJobs.secretaryVoiceJobs ??= { processKey: crypto.randomUUID(), tails: new Map() };
export async function recoverVoiceJobs() {
  await (jobState.recovery ??= db.voiceJob.updateMany({ where: { status: { in: ['queued', 'running'] }, processKey: { not: jobState.processKey } },
    data: { status: 'failed', error: '服务重启，部分操作可能已保存，请先查看记录，不要重复提交。' } }));
}
