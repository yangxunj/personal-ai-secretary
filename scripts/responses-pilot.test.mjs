import test from 'node:test';
import assert from 'node:assert/strict';
import { clientFor, fakeTaskExecutor, loadConfig, sseEvents, textOf } from './responses-pilot.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const config = { baseUrl: 'https://api.openai.com/v1', apiKey: 'fictional-key-must-not-leak', model: 'fictional-model' };
const message = text => ({ status: 'completed', id: 'resp_fixture', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
test('SSE handles split UTF-8, CRLF and multiple events and rejects a truncated final block', async () => {
  const text = 'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '你好' }) + '\r\n\r\n: ping\r\n\r\ndata: [DONE]\r\n\r\n';
  const bytes = new TextEncoder().encode(text), chunks = [...bytes].map(b => Uint8Array.of(b));
  const events = []; for await (const e of sseEvents(chunks)) events.push(e);
  assert.equal(events.length, 1); assert.equal(events[0].delta, '你好');
  await assert.rejects(async () => { for await (const e of sseEvents([new TextEncoder().encode('data: {}')])) void e; }, /truncated/);
});
test('stream requires completed final response and checks it against visible deltas', async () => {
  const response = data => new Response(data, { headers: { 'content-type': 'text/event-stream' } });
  const event = value => 'data: ' + JSON.stringify(value) + '\n\n';
  const client = clientFor(config, { fetchImpl: async () => response(event({ type: 'response.output_text.delta', delta: 'OK' }) + event({ type: 'response.completed', response: message('OK') })) });
  assert.equal((await client.post('stream', '/responses', { stream: true })).summary.streamMatchesFinal, true);
  const incomplete = clientFor(config, { fetchImpl: async () => response(event({ type: 'response.output_text.delta', delta: 'OK' })) });
  assert.equal((await incomplete.post('stream', '/responses', { stream: true })).summary.ok, false);
  assert.equal(textOf({ output: [{ type: 'reasoning', text: 'private' }, ...message('visible').output] }), 'visible');
});
test('requests have hard caps, no retries, no redirects, and sanitized failure reports', async () => {
  let calls = 0; const summaries = [];
  const client = clientFor(config, { limit: 1, onResult: s => summaries.push(s), fetchImpl: async (_url, options) => { calls++; assert.equal(options.redirect, 'error'); throw new Error(config.apiKey); } });
  await client.post('one', '/responses', {}); await assert.rejects(client.post('two', '/responses', {}), /limit/);
  assert.equal(calls, 1); assert(!JSON.stringify(summaries).includes(config.apiKey));
  const rejected = clientFor(config, { fetchImpl: async () => Response.json({ error: { message: config.apiKey, code: config.apiKey } }, { status: 400 }) });
  assert(!JSON.stringify((await rejected.post('invalid', '/responses', {})).summary).includes(config.apiKey));
});
test('HTTP 200 with an unknown parameter is not evidence of a compaction item', async () => {
  const client = clientFor(config, { fetchImpl: async () => Response.json({ ...message('OK'), usage: { prompt_tokens: 7906, completion_tokens: 1, total_tokens: 7907 } }) });
  const { summary } = await client.post('ignored_parameter', '/responses', { context_management: 'invalid' });
  assert.equal(summary.ok, true); assert.equal(summary.usage.input_tokens, 7906); assert(!summary.outputTypes.includes('compaction'));
});
test('fictional task tool validates scope and rejects changed arguments on a repeated call', () => {
  const tool = fakeTaskExecutor(), call = { name: 'createTask', call_id: 'call_fixture', arguments: JSON.stringify({ title: 'Fictional pilot task 123', dueDate: '2026-12-15' }) };
  assert.deepEqual(tool.execute(call), tool.execute(call)); assert.equal(tool.size, 1);
  assert.throws(() => tool.execute({ ...call, arguments: JSON.stringify({ title: 'Fictional pilot task other', dueDate: '2026-12-15' }) }), /mismatch/);
  assert.throws(() => tool.execute({ ...call, name: 'deleteTask' }), /invalid_tool/);
  assert.throws(() => tool.execute({ ...call, arguments: JSON.stringify({ title: 'real task', dueDate: '2026-12-15' }) }), /arguments/);
});
test('DeepSeek profile selects only its dedicated key and does not reuse another provider key', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'responses-config-test-'));
  t.after(() => { const rel = path.relative(os.tmpdir(), root); assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel)); rmSync(root, { recursive: true, force: true }); });
  const variables = ['DEEPSEEK_API_KEY', 'AI_BASE_URL', 'AI_API_KEY'];
  const inherited = new Map(variables.map(k => [k, process.env[k]])); for (const k of variables) delete process.env[k];
  t.after(() => { for (const [k,v] of inherited) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  writeFileSync(path.join(root, '.env'), 'AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1\nAI_API_KEY=fictional-alibaba-key\n');
  assert.throws(() => loadConfig(root, { provider: 'deepseek' }), /missing_deepseek_key/);
  writeFileSync(path.join(root, '.env'), 'DEEPSEEK_API_KEY=fictional-official-key\nAI_API_KEY=fictional-alibaba-key\n');
  assert.deepEqual(loadConfig(root, { provider: 'deepseek' }), { baseUrl: 'https://api.deepseek.com', apiKey: 'fictional-official-key', model: 'deepseek-flash' });
});
test('HTTP 200 with ignored previous-response state is distinguished from a linked response', async () => {
  const client = clientFor(config, { fetchImpl: async () => Response.json({ ...message('UNKNOWN'), store: false, previous_response_id: null }) });
  const { summary } = await client.post('ignored_state', '/responses', { previous_response_id: 'resp_fixture', store: true });
  assert.equal(summary.ok, true); assert.equal(summary.stored, false); assert.equal(summary.previousResponseLinked, false);
});
