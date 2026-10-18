import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/lib/db';
import { getAiConfig } from '@/lib/ai-config';
import { getChatBackend, getCodexConfig, openCodex } from '@/lib/codex/config';
import { denyRequest, runTurn } from '@/lib/codex/protocol.mjs';
import { MAIL_INSTRUCTIONS, MAIL_SCHEMA, validateDecisions } from './decisions.mjs';

async function resolveAnalysis() {
  const backend = await getChatBackend();
  const cfg = backend === 'codex' ? await getCodexConfig() : await getAiConfig();
  const target = backend === 'codex' ? `Codex · ${cfg.model || 'default'}` : `${'baseUrl' in cfg ? cfg.baseUrl : ''} · ${cfg.model}`;
  let label = target;
  if ('baseUrl' in cfg) { try { const url = new URL(cfg.baseUrl); label = `${url.host}${url.pathname} · ${cfg.model}`; } catch { label = cfg.model || 'API'; } }
  return { cfg, target: { backend, label, key: createHash('sha256').update(backend + ':' + target).digest('hex') } };
}
export async function mailAnalysisTarget() { return (await resolveAnalysis()).target; }

export async function analyzeMessages(messages: any[], signal: AbortSignal, expectedTarget: string) {
  signal = AbortSignal.any([signal, AbortSignal.timeout(180000)]);
  const resolved = await resolveAnalysis();
  if (resolved.target.key !== expectedTarget) throw new Error('MAIL_CONSENT_CHANGED');
  const storedLocale = (await db.setting.findUnique({ where: { key: 'locale' } }))?.value;
  const locale = storedLocale === 'en' || storedLocale === 'zh' ? storedLocale : (process.env.DESKTOP_SYSTEM_LOCALE || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const prompt = JSON.stringify({ locale, today: new Date().toLocaleDateString('sv-SE'), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, messages });
  let text: string;
  if (resolved.target.backend === 'codex') {
    const { client, cfg, config } = await openCodex();
    const abort = () => client.close();
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      if (cfg.model !== resolved.cfg.model) throw new Error('MAIL_CONSENT_CHANGED');
      const cwd = path.join(process.env.GMAIL_DATA_DIR!, 'analysis'); await mkdir(cwd, { recursive: true });
      client.on('request', (msg: any) => denyRequest(client, msg));
      const { thread } = await client.request('thread/start', { cwd, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never', dynamicTools: [], config,
        baseInstructions: MAIL_INSTRUCTIONS, developerInstructions: 'Only classify the supplied mail. No business actions, tools, or filesystem work.' });
      if (thread?.ephemeral !== true || !thread.id || thread.path != null || thread.rolloutPath != null) throw new Error('MAIL_EPHEMERAL_REQUIRED');
      // Schema is sent as part of the instruction; strict local validation remains mandatory.
      text = await runTurn(client, { threadId: thread.id, effort: 'low', timeoutMs: 180000,
        input: [{ type: 'text', text: JSON.stringify({ outputSchema: MAIL_SCHEMA }) + '\n' + prompt }] });
    } finally { signal.removeEventListener('abort', abort); client.close(); }
  } else {
    const cfg = resolved.cfg as Awaited<ReturnType<typeof getAiConfig>>;
    if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) throw new Error('MAIL_AI_CONFIG_REQUIRED');
    const provider = createOpenAICompatible({ name: 'ai', baseURL: cfg.baseUrl, apiKey: cfg.apiKey });
    const result = await generateText({ model: provider.chatModel(cfg.model), system: MAIL_INSTRUCTIONS,
      prompt: JSON.stringify({ outputSchema: MAIL_SCHEMA }) + '\n' + prompt, abortSignal: signal, maxRetries: 0, maxOutputTokens: 16000 });
    text = result.text;
  }
  signal.throwIfAborted();
  const json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return validateDecisions(JSON.parse(json), messages);
}
