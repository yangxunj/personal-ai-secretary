import path from 'node:path';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { MailStore, initialMailState } from './store.mjs';
import { GwsMailReader } from './gws.mjs';
import { scanBatch } from './scan-core.mjs';
import { analyzeMessages, mailAnalysisTarget } from './analysis';

type Runtime = { store: MailStore; running: Promise<void> | null; abort: AbortController | null; generation: number; timer?: ReturnType<typeof setTimeout> };
const globalMail = globalThis as unknown as { secretaryMail?: Runtime };
function runtime() {
  if (process.env.DESKTOP_APP !== '1' || !process.env.GMAIL_DATA_DIR || !process.env.GMAIL_GWS_PATH) throw new Error('MAIL_DESKTOP_ONLY');
  return globalMail.secretaryMail ??= { store: new MailStore(process.env.GMAIL_DATA_DIR), running: null, abort: null, generation: 0 };
}
const safeError = (error: any) => ['MAIL_CONSENT_CHANGED', 'MAIL_AI_CONFIG_REQUIRED', 'MAIL_EPHEMERAL_REQUIRED', 'MAIL_INVALID_RESULT', 'MAIL_INVALID_EVIDENCE', 'MAIL_STATE_INVALID'].includes(error?.message)
  ? error.message : Number(error?.status) === 401 || Number(error?.status) === 403 ? 'MAIL_AUTH_REQUIRED' : 'MAIL_SCAN_FAILED';

export async function mailSnapshot() {
  const rt = runtime(), state = await rt.store.read();
  const target = await mailAnalysisTarget(), approved = !!state?.analysisApproved && state.analysisTarget === target.key;
  return { connected: !!state, running: !!rt.running, account: state?.account ?? null, enabled: !!state?.enabled && approved,
    analysisApproved: approved, notifications: !!state?.notifications, intervalMinutes: state?.intervalMinutes ?? 60,
    lastSuccessAt: state?.lastSuccessAt ?? null, lastError: state?.analysisApproved && !approved ? 'MAIL_CONSENT_CHANGED' : state?.lastError ?? null, totalAnalyzed: state?.totalAnalyzed ?? 0,
    morePending: !!state?.morePending, findings: [...(state?.findings ?? [])].reverse(), analysisTarget: target };
}
async function reschedule() {
  const rt = runtime(), generation = rt.generation; clearTimeout(rt.timer);
  const state = await rt.store.read();
  if (generation !== rt.generation || !state?.enabled || !state.analysisApproved) return;
  rt.timer = setTimeout(() => { void startMailSync().catch(() => {}); }, state.morePending ? 60000 : state.intervalMinutes * 60000);
  rt.timer.unref?.();
}
export async function startMailSync() {
  const rt = runtime(); if (rt.running) return;
  clearTimeout(rt.timer); const controller = new AbortController(), generation = rt.generation; rt.abort = controller;
  rt.running = rt.store.update(async state => {
    if (!state?.analysisApproved) throw new Error('MAIL_ANALYSIS_CONSENT_REQUIRED');
    if ((await mailAnalysisTarget()).key !== state.analysisTarget) throw new Error('MAIL_CONSENT_CHANGED');
    const reader = new GwsMailReader({ executable: process.env.GMAIL_GWS_PATH, configDir: path.join(process.env.GMAIL_DATA_DIR!, 'account'), signal: controller.signal });
    const next = await scanBatch({ state, reader, account: state.account, limit: 20,
      analyze: (messages: any[]) => analyzeMessages(messages, controller.signal, state.analysisTarget) });
    controller.signal.throwIfAborted();
    next.findings = next.findings.slice(-500);
    // IDs older than a completed window are no longer needed for its bounded overlap.
    if (!next.morePending) next.seen = next.seen.slice(-5000);
    return next;
  }).then(() => {}).catch(async error => {
    if (!controller.signal.aborted) await rt.store.update(state => state ? { ...state, lastError: safeError(error), lastCheckedAt: new Date().toISOString(),
      ...(error.message === 'MAIL_CONSENT_CHANGED' ? { enabled: false, analysisApproved: false } : {}) } : null).catch(() => {});
  }).finally(() => { rt.running = null; rt.abort = null; if (generation === rt.generation) void reschedule().catch(() => {}); });
}
export async function stopMailSync() {
  const rt = runtime(); rt.generation++; clearTimeout(rt.timer); rt.abort?.abort();
  await rt.running;
  clearTimeout(rt.timer);
}
export async function mailCommand(action: string, input: any = {}) {
  const rt = runtime();
  switch (action) {
    case 'status': return mailSnapshot();
    case 'stop': await stopMailSync(); return { stopped: true };
    case 'pause': {
      await stopMailSync(); await rt.store.update(state => state ? { ...state, enabled: false } : null); break;
    }
    case 'connected': {
      if (await rt.store.read()) throw new Error('MAIL_DISCONNECT_FIRST');
      await rt.store.update(() => initialMailState(input.email)); break;
    }
    case 'configure': {
      await stopMailSync();
      const target = await mailAnalysisTarget();
      if (input.analysisApproved && input.targetKey !== target.key) throw new Error('MAIL_CONSENT_CHANGED');
      await rt.store.update(state => {
        if (!state) throw new Error('MAIL_AUTH_REQUIRED');
        return { ...state, analysisApproved: input.analysisApproved === true, analysisTarget: input.analysisApproved ? target.key : '',
          enabled: input.enabled === true && input.analysisApproved === true, notifications: input.notifications === true,
          intervalMinutes: [10, 30, 60].includes(input.intervalMinutes) ? input.intervalMinutes : 60 };
      });
      await reschedule(); break;
    }
    case 'sync': {
      if (!(await rt.store.read())?.analysisApproved) throw new Error('MAIL_ANALYSIS_CONSENT_REQUIRED');
      await startMailSync(); break;
    }
    case 'disconnect': {
      await stopMailSync();
      await rt.store.clear();
      break;
    }
    case 'mark': {
      if (rt.running) throw new Error('MAIL_BUSY');
      if (!['review', 'done', 'ignored'].includes(input.status)) throw new Error('MAIL_INVALID_INPUT');
      await rt.store.update(state => {
        const item = state?.findings.find((f: any) => f.id === input.id);
        if (!item) throw new Error('MAIL_NOT_FOUND'); item.status = input.status; return state;
      }); break;
    }
    case 'task': {
      if (rt.running) throw new Error('MAIL_BUSY');
      let taskId = '';
      await rt.store.update(async state => {
        if (!state) throw new Error('MAIL_AUTH_REQUIRED');
        const item = state?.findings.find((f: any) => f.id === input.id);
        if (!item) throw new Error('MAIL_NOT_FOUND');
        taskId = 'mail' + createHash('sha256').update(state.account + ':' + item.id).digest('hex').slice(0, 28);
        // A stable id makes repeat clicks and recovery after a ledger write failure idempotent.
        await db.task.upsert({ where: { id: taskId }, update: {}, create: { id: taskId, title: item.summary,
          detail: [item.action, item.evidence, item.sourceUrl].filter(Boolean).join('\n\n'),
          dueDate: item.dueDate ? new Date(item.dueDate + 'T00:00:00') : null } });
        item.taskId = taskId; item.status = 'done'; return state;
      });
      return { ...(await mailSnapshot()), taskId };
    }
    case 'notifications': {
      if (rt.running) return { count: 0 };
      let count = 0;
      await rt.store.update(state => {
        if (!state?.notifications) return null;
        for (const item of state.findings) if (!item.notified && !['done', 'ignored'].includes(item.status || '')) { item.notified = true; count++; }
        return count ? state : null;
      }); return { count };
    }
    default: throw new Error('MAIL_INVALID_ACTION');
  }
  return mailSnapshot();
}
export async function startMailScheduler() {
  if (process.env.DESKTOP_APP !== '1' || !process.env.GMAIL_DATA_DIR) return;
  // Missing or damaged ledgers never trigger a historical scan automatically.
  const state = await runtime().store.read();
  if (state?.enabled && state.analysisApproved) await startMailSync();
}
