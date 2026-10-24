import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHost, createTransport, checkedFile, within } from './host.mjs';
import { createRuntime, prompt } from './runtime.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'secretary-pi-test-'));
  t.after(async () => { assert(within(os.tmpdir(), root) && path.basename(root).startsWith('secretary-pi-test-')); await fs.rm(root, { recursive: true, force: true }); });
  await fs.mkdir(path.join(root, 'inputs'));
  await fs.writeFile(path.join(root, 'inputs/task-a-quote.txt'), 'Synthetic quote 288 CNY. Shipping included.');
  await fs.writeFile(path.join(root, 'inputs/task-b-quote.txt'), 'Private to task b.');
  return root;
}

function sse(text, call, inputTokens = 90) {
  const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-call', type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { role: 'assistant', content: text };
  const chunks = [
    { id: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] },
    { id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] },
    { id: 'fixture', choices: [], usage: { prompt_tokens: inputTokens, completion_tokens: 12, total_tokens: inputTokens + 12 } },
  ];
  return new Response(chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

test('attachment business scope and current-turn citations cannot be bypassed by invented markers', async t => {
  const root = await fixture(t), host = await createHost(root), read = host.tools.find(t => t.name === 'secretary_read_file');
  await assert.rejects(read.execute('denied', { attachmentId: 'task-b-quote' }), /scope_denied/);
  const result = JSON.parse((await read.execute('allowed', { attachmentId: 'task-a-quote' })).content[0].text);
  assert.equal(host.finalize(`288[[cite:${result.citation.id}]]`).citations.length, 1);
  assert.equal(host.finalize('fake[[cite:invented]]').rejected, 1);
  host.beginTurn(); assert.equal(host.finalize(`old[[cite:${result.citation.id}]]`).citations.length, 0);
});
test('business receipts deduplicate across restart and reject changed operations', async t => {
  const root = await fixture(t), args = { requestId: 'req-1', title: 'Fictional task', dueDate: '2026-12-15' };
  const first = await createHost(root); await first.tools[1].execute('call-1', args);
  const restored = await createHost(root); await restored.tools[1].execute('call-2', args);
  assert.equal(restored.tasks.length, 1);
  await assert.rejects(restored.tools[1].execute('call-3', { ...args, title: 'Changed' }), /request_changed/);
});
test('file tools deny traversal, absolute paths, overwrite, links and cross-task outputs', async t => {
  const root = await fixture(t), a = await createHost(root), b = await createHost(root, 'task-b');
  const write = a.tools[2], read = a.tools[3];
  for (const filename of ['../escape.txt', path.join(root, 'absolute.txt'), 'folder/x.txt', 'x.html']) {
    await assert.rejects(write.execute(filename, { filename, content: 'x' }), /invalid_output/);
  }
  a.beginTurn(); await write.execute('valid', { filename: 'result.txt', content: 'OK' });
  assert.equal(JSON.parse((await read.execute('back', { filename: 'result.txt' })).content[0].text).text, 'OK');
  await assert.rejects(write.execute('overwrite', { filename: 'result.txt', content: 'Changed' }), /EEXIST/);
  await assert.rejects(b.tools[3].execute('cross', { filename: 'result.txt' }), /ENOENT/);
  await fs.link(path.join(root, 'inputs/task-b-quote.txt'), path.join(root, 'outputs/task-a/link.txt'));
  await assert.rejects(checkedFile(path.join(root, 'outputs/task-a'), 'link.txt'), /invalid_file/);
});
test('HTTP transport enforces official host, real request cap and no resend after failure', async t => {
  const root = await fixture(t); let sent = 0;
  const body = JSON.stringify({ model: 'deepseek-flash', stream: true, max_tokens: 512, messages: [] });
  const transport = createTransport(root, { limit: 1, fetchImpl: async () => { sent++; return new Response('unlogged provider body', { status: 400 }); } });
  await assert.rejects(transport.fetch('https://other.example/chat/completions', { method: 'POST', body }), /network_denied/);
  await transport.fetch('https://api.deepseek.com/chat/completions', { method: 'POST', body });
  await assert.rejects(transport.fetch('https://api.deepseek.com/chat/completions', { method: 'POST', body }), /network_denied/);
  assert.equal(sent, 1); assert(!JSON.stringify(await transport.read()).includes('provider body'));
  const capped = createTransport(root, { limit: 1, fetchImpl: async () => { sent++; return sse('OK'); } });
  await assert.rejects(capped.fetch('https://api.deepseek.com/chat/completions', { method: 'POST', body }), /request_limit/);
});
test('real Pi SDK streams, executes host tool and restores canonical history without global resources', async t => {
  const root = await fixture(t), host = await createHost(root); let requests = 0;
  const args = { requestId: 'fixture-req', title: 'Fictional SDK task', dueDate: '2026-12-15' };
  const transport = createTransport(root, { fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body); requests++;
    if (requests === 1) return sse('', { name: 'secretary_create_task', arguments: args });
    if (requests === 2) { assert(body.messages.some(m => m.role === 'tool')); return sse('Saved fictional-task-1'); }
    assert(body.messages.some(m => JSON.stringify(m).includes('fictional-task-1'))); return sse('restored');
  } });
  const runtime = await createRuntime({ root, apiKey: 'fictional-key', host, transport });
  try {
    assert.deepEqual(runtime.session.getActiveToolNames().sort(), host.tools.map(t => t.name).sort());
    assert.equal(await prompt(runtime, host, 'Create a synthetic task.'), 'Saved fictional-task-1');
    assert.equal(host.tasks.length, 1); assert(runtime.streamCharacters > 0);
    const sessionFile = runtime.manager.getSessionFile(); runtime.session.dispose();
    const restored = await createRuntime({ root, apiKey: 'fictional-key', host, transport, sessionFile });
    try { assert.equal(await prompt(restored, host, 'Continue'), 'restored'); } finally { restored.session.dispose(); }
  } finally { runtime.session.dispose(); }
  assert.equal(requests, 3);
});

test('real Pi automatic compaction uses the same bounded transport and persists summary state', async t => {
  const root = await fixture(t), host = await createHost(root); let requests = 0;
  const transport = createTransport(root, { fetchImpl: async () => {
    requests++;
    if (requests === 1) return sse('OK');
    if (requests === 2) return sse('OK', undefined, 7200);
    return sse('# Summary\nPreserve pilot-fixture-marker for future recall. Disposable filler has no facts.');
  } });
  const runtime = await createRuntime({ root, apiKey: 'fictional-key', host, transport });
  try {
    await prompt(runtime, host, 'Remember pilot-fixture-marker. Reply OK.');
    await prompt(runtime, host, 'Disposable filler.\n'.repeat(2000));
    const summaries = runtime.manager.getEntries().filter(e => e.type === 'compaction');
    assert(summaries.length > 0); assert(summaries.at(-1).summary.includes('pilot-fixture-marker'));
    assert(runtime.compactionEvents.some(e => e.reason === 'threshold' && e.succeeded)); assert(requests >= 3 && requests <= 4);
    assert.equal((await transport.read()).length, requests);
  } finally { runtime.session.dispose(); }
});

test('cancelling an in-flight SDK run performs no business write or hidden network retry', async t => {
  const root = await fixture(t), host = await createHost(root); let sent = 0;
  let started; const ready = new Promise(resolve => { started = resolve; });
  const transport = createTransport(root, { fetchImpl: async (_url, init) => {
    sent++; started();
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('fixture_aborted')), { once: true }));
  } });
  const runtime = await createRuntime({ root, apiKey: 'fictional-key', host, transport });
  try {
    const pending = assert.rejects(prompt(runtime, host, 'Create a task later.'), /incomplete_model/);
    await ready; await runtime.session.abort(); await pending;
    assert.equal(sent, 1); assert.equal(host.tasks.length, 0);
  } finally { runtime.session.dispose(); }
});

test('explicit compaction with a small retained tail reduces the canonical model context', async t => {
  const root = await fixture(t), host = await createHost(root); let requests = 0;
  const transport = createTransport(root, { fetchImpl: async () => {
    requests++; return sse(requests <= 3 ? 'OK' : 'Preserve pilot-fixture-marker. All earlier filler is disposable.');
  } });
  const runtime = await createRuntime({ root, apiKey: 'fictional-key', host, transport, keepRecentTokens: 128 });
  runtime.session.setAutoCompactionEnabled(false);
  try {
    await prompt(runtime, host, 'Remember pilot-fixture-marker.');
    await prompt(runtime, host, 'Disposable filler.\n'.repeat(800));
    // Enough recent material to place the cut after the earlier single large message.
    await prompt(runtime, host, 'Continue to retain the original marker. '.repeat(24));
    const before = JSON.stringify(runtime.manager.buildSessionContext()).length;
    const compacted = await runtime.session.compact('Retain the marker.');
    assert(compacted.summary.includes('pilot-fixture-marker'));
    assert(JSON.stringify(runtime.manager.buildSessionContext()).length < before / 2);
  } finally { runtime.session.dispose(); }
});
