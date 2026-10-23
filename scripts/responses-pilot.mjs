#!/usr/bin/env node
// Isolated protocol pilot. No application writes, imported production tools or automatic retries.
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MAX_REQUESTS = 12;
const INSTRUCTIONS = 'This is a synthetic protocol test. Use only facts in this conversation and supplied tool results. Do not guess missing facts. Reply briefly. Never call an external service.';
export const textOf = response => (response?.output || []).filter(i => i.type === 'message').flatMap(i => i.content || []).filter(i => i.type === 'output_text').map(i => i.text).join('');
const usageOf = value => {
  const counts = { input_tokens: value?.input_tokens ?? value?.prompt_tokens, output_tokens: value?.output_tokens ?? value?.completion_tokens, total_tokens: value?.total_tokens };
  return Object.fromEntries(Object.entries(counts).filter(([, v]) => Number.isFinite(v)));
};
const fingerprint = config => createHash('sha256').update(config.baseUrl + '\n' + config.model).digest('hex');

export function loadConfig(root = process.cwd()) {
  const local = fs.existsSync(path.join(root, '.env')) ? parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8')) : {};
  const env = { ...local, ...process.env };
  const dbUrl = env.DATABASE_URL || 'file:../data/secretary.db';
  if (!dbUrl.startsWith('file:')) throw new Error('pilot_requires_sqlite');
  // Read only model settings; never load messages, documents or business records.
  const saved = new Map();
  const dbPath = path.resolve(root, 'prisma', dbUrl.slice(5));
  if (fs.existsSync(dbPath)) {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try { for (const r of db.prepare('SELECT key,value FROM Setting WHERE key IN (?,?,?)').all('ai.baseUrl', 'ai.apiKey', 'ai.model')) saved.set(r.key, r.value); }
    finally { db.close(); }
  }
  const pick = (k, fallback) => (saved.get(k)?.trim() || fallback || '').trim();
  const config = { baseUrl: pick('ai.baseUrl', env.AI_BASE_URL).replace(/\/+$/, ''), apiKey: pick('ai.apiKey', env.AI_API_KEY), model: pick('ai.model', env.AI_MODEL) };
  const u = new URL(config.baseUrl);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !config.apiKey || !config.model || /[\r\n]/.test(config.apiKey)) throw new Error('pilot_invalid_config');
  if (!(u.hostname === 'api.openai.com' || /^dashscope(?:-intl|-us)?\.aliyuncs\.com$/.test(u.hostname) || /^[\w-]+\.(?:cn-beijing|ap-southeast-1|us-east-1|eu-central-1|ap-northeast-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(u.hostname))) throw new Error('pilot_provider_not_allowlisted');
  return config;
}

export async function* sseEvents(body) {
  const decoder = new TextDecoder(); let buffer = '';
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    if (buffer.length > 2 * 1024 * 1024) throw new Error('pilot_stream_too_large');
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
      const data = block.split(/\r?\n/).filter(s => s.startsWith('data:')).map(s => s.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) throw new Error('pilot_truncated_stream');
}

export function clientFor(config, { fetchImpl = fetch, limit = MAX_REQUESTS, onResult = () => {} } = {}) {
  let requests = 0;
  async function post(label, endpoint, payload) {
    if (requests >= limit) throw new Error('pilot_request_limit');
    requests++; const start = performance.now(); let firstTextMs = null, data = null;
    const summary = { label, request: requests, httpStatus: null, ok: false, stream: !!payload.stream };
    try {
      const response = await fetchImpl(config.baseUrl + endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey }, body: JSON.stringify(payload) });
      summary.httpStatus = response.status;
      if (response.ok && payload.stream) {
        if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('pilot_invalid_stream_type');
        let streamed = '', completed = false;
        for await (const event of sseEvents(response.body)) {
          if (event.type === 'response.output_text.delta') { firstTextMs ??= Math.round(performance.now() - start); streamed += event.delta || ''; }
          if (event.type === 'response.failed' || event.type === 'error') throw new Error('pilot_failed_stream');
          if (event.type === 'response.completed') { data = event.response; completed = true; }
        }
        if (!completed || !data || data.status !== 'completed') throw new Error('pilot_incomplete_stream');
        summary.streamMatchesFinal = streamed === textOf(data);
      } else {
        const body = await response.text();
        if (body.length > 2 * 1024 * 1024) throw new Error('pilot_response_too_large');
        try { data = JSON.parse(body); } catch { data = null; }
      }
      summary.ok = response.ok && !!data;
      if (!response.ok) summary.error = response.status === 401 || response.status === 403 ? 'credentials_or_access' : response.status === 404 ? 'endpoint_or_response_not_found' : 'provider_rejected_request';
      if (summary.ok) {
        summary.responseStatus = data.status || null; summary.idPresent = typeof data.id === 'string';
        summary.outputTypes = [...new Set((data.output || []).map(i => i.type))];
        summary.usage = usageOf(data.usage); summary.textCharacters = textOf(data).length;
      }
    } catch { summary.error = 'network_or_protocol_error'; summary.ok = false; }
    summary.latencyMs = Math.round(performance.now() - start); if (firstTextMs !== null) summary.firstTextMs = firstTextMs;
    // Only the deliberately small summary is persisted. No headers, provider error bodies or opaque items.
    onResult(summary);
    return { summary, data };
  }
  return { post, get requests() { return requests; } };
}

export function fakeTaskExecutor() {
  const tasks = new Map(), calls = new Map();
  return {
    execute(call) {
      if (call.name !== 'createTask' || typeof call.call_id !== 'string' || !call.call_id) throw new Error('pilot_invalid_tool');
      const args = JSON.parse(call.arguments);
      if (Object.keys(args).some(k => !['title', 'dueDate'].includes(k)) || typeof args.title !== 'string' || !args.title.startsWith('Fictional pilot task ') || args.dueDate !== '2026-12-15') throw new Error('pilot_invalid_tool_arguments');
      const previous = calls.get(call.call_id);
      if (previous) { if (previous.arguments !== call.arguments) throw new Error('pilot_call_id_mismatch'); return previous.result; }
      const result = { ok: true, id: 'fictional-task-001', ...args };
      tasks.set(result.id, result); calls.set(call.call_id, { arguments: call.arguments, result }); return result;
    },
    get size() { return tasks.size; },
  };
}

async function resumeCheckpoint(file) {
  const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8')), config = loadConfig();
  if (checkpoint.version !== 1 || checkpoint.fingerprint !== fingerprint(config) || typeof checkpoint.responseId !== 'string' || !/^pilot-[a-f0-9-]{36}$/.test(checkpoint.marker)) throw new Error('pilot_invalid_checkpoint');
  const client = clientFor(config, { limit: 1 });
  const result = await client.post('independent_process_resume', '/responses', { model: config.model, instructions: INSTRUCTIONS, previous_response_id: checkpoint.responseId, input: 'What exact marker did I ask you to remember? Reply with that marker only.', max_output_tokens: 256, reasoning: { effort: 'none' }, store: true });
  // The next request does not contain the answer or any replayed history.
  return { ...result.summary, passed: result.summary.ok && result.data?.status === 'completed' && textOf(result.data).trim() === checkpoint.marker };
}

async function main() {
  const resume = process.argv.find(a => a.startsWith('--resume='));
  if (!process.argv.includes('--live')) { console.log('Usage: node scripts/responses-pilot.mjs --live\nUses current model settings read-only, synthetic data, at most 12 POSTs, no retries. Results: data/responses-pilot/. No production chat changes.'); return; }
  if (resume) { console.log(JSON.stringify(await resumeCheckpoint(resume.slice(9)))); return; }
  const config = loadConfig(), dir = path.resolve('data/responses-pilot', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const report = { version: 1, at: new Date().toISOString(), providerHost: new URL(config.baseUrl).host, model: config.model, maxRequests: MAX_REQUESTS, syntheticOnly: true, productionWrites: false, applicationIntegrationVerified: false, requests: [], checks: {}, usage: {}, conclusion: 'not_evaluated' };
  const save = () => fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  const client = clientFor(config, { limit: MAX_REQUESTS - 1, onResult: s => { report.requests.push(s); save(); console.log(JSON.stringify(s)); } });
  const base = { model: config.model, instructions: INSTRUCTIONS, reasoning: { effort: 'none' }, max_output_tokens: 512, store: true };
  try {
    const control = await client.post('chat_completions_control', '/chat/completions', { model: config.model, messages: [{ role: 'user', content: 'Reply exactly OK.' }], max_tokens: 256, stream: false, ...(/aliyuncs\.com$/.test(new URL(config.baseUrl).host) ? { enable_thinking: false } : {}) });
    report.checks.currentEndpointWorks = control.summary.ok && control.data?.choices?.[0]?.message?.content?.trim() === 'OK';
    const marker = 'pilot-' + randomUUID();
    const seed = await client.post('responses_memory_seed', '/responses', { ...base, input: `Remember this exact synthetic marker for later: ${marker}. Reply only OK.` });
    report.checks.responsesBasic = seed.summary.ok && seed.data?.status === 'completed' && textOf(seed.data).trim() === 'OK' && typeof seed.data.id === 'string';
    if (!report.checks.responsesBasic) { report.conclusion = 'responses_basic_failed'; return; }
    const checkpoint = path.join(dir, 'checkpoint.json');
    fs.writeFileSync(checkpoint, JSON.stringify({ version: 1, fingerprint: fingerprint(config), responseId: seed.data.id, marker }), { mode: 0o600 });
    try {
      const resumed = JSON.parse(execFileSync(process.execPath, [path.resolve('scripts/responses-pilot.mjs'), '--live', '--resume=' + checkpoint], { encoding: 'utf8', timeout: 75000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
      report.requests.push(resumed); report.checks.independentProcessResume = resumed.passed === true; save(); console.log(JSON.stringify(resumed));
    } catch { report.checks.independentProcessResume = false; report.requests.push({ label: 'independent_process_resume', ok: false, error: 'independent_process_failed', executionUncertain: true }); }
    const title = 'Fictional pilot task ' + randomUUID().slice(0, 8);
    const tools = [{ type: 'function', name: 'createTask', description: 'Creates one fictional task in an isolated in-memory test store.', parameters: { type: 'object', properties: { title: { type: 'string' }, dueDate: { type: 'string' } }, required: ['title', 'dueDate'], additionalProperties: false }, strict: true }];
    const called = await client.post('function_call', '/responses', { ...base, tools, tool_choice: 'required', input: `Call createTask exactly once with title "${title}" and dueDate "2026-12-15". After receiving the result, report its exact saved id and title.` });
    const calls = (called.data?.output || []).filter(i => i.type === 'function_call');
    const store = fakeTaskExecutor();
    if (called.summary.ok && calls.length === 1) {
      const result = store.execute(calls[0]); store.execute(calls[0]);
      report.checks.toolArgumentsAndDeduplication = result.title === title && store.size === 1;
      const reply = await client.post('function_output_stream', '/responses', { ...base, previous_response_id: called.data.id, tools, tool_choice: 'none', stream: true, input: [{ type: 'function_call_output', call_id: calls[0].call_id, output: JSON.stringify(result) }] });
      report.checks.toolOutputAndStreaming = reply.summary.ok && reply.summary.streamMatchesFinal && textOf(reply.data).includes('fictional-task-001') && textOf(reply.data).includes(title);
    } else { report.checks.toolArgumentsAndDeduplication = false; report.checks.toolOutputAndStreaming = false; }
    const isolated = await client.post('new_conversation_isolation', '/responses', { ...base, input: 'What exact marker did I ask you to remember? If none is present in this conversation, reply exactly UNKNOWN.' });
    report.checks.newConversationIsolated = isolated.summary.ok && textOf(isolated.data).trim() === 'UNKNOWN';
    const invalid = await client.post('invalid_previous_id', '/responses', { ...base, previous_response_id: 'resp_pilot_nonexistent_' + randomUUID().replaceAll('-', ''), input: 'Reply exactly OK.' });
    report.checks.invalidIdRejected = !invalid.summary.ok && [400, 404, 422].includes(invalid.summary.httpStatus);
    const compact = await client.post('standalone_compaction', '/responses/compact', { model: config.model, input: [{ role: 'user', content: 'Synthetic fact: code FOX-731, date 2026-12-15.' }, { role: 'assistant', content: 'Noted.' }] });
    report.checks.standaloneCompactionItem = compact.summary.ok && (compact.data?.output || []).some(i => i.type === 'compaction' && typeof i.encrypted_content === 'string');
    const negative = await client.post('invalid_compaction_parameter_control', '/responses', { ...base, input: 'Reply exactly OK.', context_management: 'deliberately-invalid-pilot-value' });
    report.checks.invalidCompactionParameterRejected = !negative.summary.ok && [400, 422].includes(negative.summary.httpStatus);
    const compactMarker = 'pilot-' + randomUUID();
    const long = await client.post('server_compaction_threshold', '/responses', { ...base, context_management: [{ type: 'compaction', compact_threshold: 1024 }], input: `Keep the exact synthetic code ${compactMarker}.\n` + 'Synthetic filler: sky, river, stone, tree.\n'.repeat(650) + '\nReply only OK. Keep the code for later.' });
    report.checks.serverCompactionItem = long.summary.ok && (long.data?.output || []).some(i => i.type === 'compaction' && typeof i.encrypted_content === 'string');
    report.checks.compactionThresholdExceeded = (long.summary.usage?.input_tokens || 0) > 1024;
    if (long.summary.ok && long.data?.id) {
      const recall = await client.post('after_threshold_recall', '/responses', { ...base, previous_response_id: long.data.id, input: 'What exact synthetic code was at the beginning? Reply with that code only.' });
      report.checks.afterThresholdRecall = recall.summary.ok && textOf(recall.data).trim() === compactMarker;
    }
    report.conclusion = report.checks.independentProcessResume && report.checks.toolArgumentsAndDeduplication && report.checks.toolOutputAndStreaming && report.checks.newConversationIsolated && report.checks.invalidIdRejected ? 'core_protocol_passed' : 'core_protocol_incomplete';
  } finally {
    for (const r of report.requests) for (const [k, v] of Object.entries(r.usage || {})) report.usage[k] = (report.usage[k] || 0) + v;
    report.observedRequests = report.requests.length;
    // Protocol success is not a production migration or long-conversation acceptance.
    report.safeToDisableApplicationCompaction = report.applicationIntegrationVerified && report.conclusion === 'core_protocol_passed' && report.checks.serverCompactionItem === true && report.checks.afterThresholdRecall === true;
    save(); console.log(JSON.stringify({ report: path.relative(process.cwd(), path.join(dir, 'report.json')), conclusion: report.conclusion, checks: report.checks, usage: report.usage, safeToDisableApplicationCompaction: report.safeToDisableApplicationCompaction }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Responses pilot stopped: configuration, validation or protocol failure. No credentials or provider bodies are printed.'); process.exitCode = 1; });
}
