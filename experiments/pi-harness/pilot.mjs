#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { loadConfig } from '../../scripts/responses-pilot.mjs';
import { createHost, createTransport, within, checkedFile } from './host.mjs';
import { createRuntime, prompt } from './runtime.mjs';

const exec = promisify(execFile), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataRoot = path.join(repo, 'data/pi-harness-pilot');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function persistedUsage(root) {
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 }; let receipts = 0;
  for (const name of await fs.readdir(path.join(root, 'sessions')).catch(() => [])) {
    for (const line of (await fs.readFile(path.join(root, 'sessions', name), 'utf8')).split('\n').filter(Boolean)) {
      const entry = JSON.parse(line), u = entry.type === 'compaction' ? entry.usage : entry.type === 'message' && entry.message?.role === 'assistant' ? entry.message.usage : undefined;
      if (!u) continue; receipts++;
      usage.input_tokens += (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
      usage.output_tokens += u.output || 0; usage.total_tokens += u.totalTokens || 0;
    }
  }
  return { usage, persistedUsageReceipts: receipts };
}
async function verifyCompaction(directory) {
  const root = await fs.realpath(directory);
  if (!within(dataRoot, root)) throw new Error('pilot_invalid_run_directory');
  const reportPath = path.join(root, 'report.json'), report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  if (report.conclusion !== 'isolated_runtime_passed' || (report.compactionFollowup && (report.compactionFollowup.conclusion !== 'incomplete' || report.observedRequests !== report.compactionFollowup.startedAtRequest))) throw new Error('pilot_followup_not_allowed');
  const checkpoint = JSON.parse(await fs.readFile(path.join(root, 'checkpoint.json'), 'utf8'));
  if (!within(root, checkpoint.sessionFile)) throw new Error('pilot_invalid_session');
  const { apiKey } = loadConfig(repo, { provider: 'deepseek' });
  const host = await createHost(root), transport = createTransport(root, { live: true, limit: 16 });
  const runtime = await createRuntime({ root, apiKey, host, transport, sessionFile: checkpoint.sessionFile, keepRecentTokens: 128 });
  // One explicit, separately bounded validation: old history can shrink while facts survive.
  report.compactionFollowup = { maxTotalRequests: 16, keepRecentTokens: 128, startedAtRequest: (await transport.read()).length, checks: {}, conclusion: 'incomplete' };
  report.baseMaxRequests = 12; report.maxRequests = 16;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  const followup = report.compactionFollowup;
  runtime.session.setAutoCompactionEnabled(false);
  try {
    const before = Buffer.byteLength(JSON.stringify(runtime.manager.buildSessionContext()));
    const compacted = await runtime.session.compact('Preserve the exact pilot marker, the saved fictional task ID and title, and quote amount/shipping/dispatched facts. Disposable synthetic filler has no informational value.');
    const after = Buffer.byteLength(JSON.stringify(runtime.manager.buildSessionContext()));
    followup.contextBytesBefore = before; followup.contextBytesAfter = after;
    followup.checks.summaryPreservesMarker = compacted.summary.includes(checkpoint.marker);
    followup.checks.contextReduced = after < before / 2;
    const reply = await prompt(runtime, host, 'Recall from this conversation the exact pilot marker, saved fictional task ID and title, and quote amount. Use memory only, no tools. Reply briefly.');
    const task = host.tasks[0];
    followup.checks.factsRetained = reply.includes(checkpoint.marker) && reply.includes(task.id) && reply.includes(task.title) && reply.includes('288');
    followup.checks.noBusinessReplay = host.audit.length === 0 && host.tasks.length === 1;
    followup.conclusion = Object.values(followup.checks).every(Boolean) ? 'passed' : 'incomplete';
  } catch (error) { followup.conclusion = 'incomplete'; followup.error = String(error.message).match(/pilot_[a-z_]+/)?.[0] || (/context|budget|window|token/i.test(error.message) ? 'sdk_summary_budget' : 'sdk_precondition_or_summary_failure'); }
  finally {
    runtime.session.dispose();
    report.requests = await transport.read(); report.observedRequests = report.requests.length;
    Object.assign(report, await persistedUsage(root));
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ compactionFollowup: followup, observedRequests: report.observedRequests, usage: report.usage }));
    if (followup.conclusion !== 'passed') process.exitCode = 1;
  }
}
async function resume(checkpointPath) {
  const file = await fs.realpath(checkpointPath), root = path.dirname(file);
  if (!within(dataRoot, file)) throw new Error('pilot_invalid_checkpoint');
  const checkpoint = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!within(root, checkpoint.sessionFile) || !/^pilot-[a-f0-9-]{36}$/.test(checkpoint.marker)) throw new Error('pilot_invalid_checkpoint');
  const { apiKey } = loadConfig(repo, { provider: 'deepseek' });
  const host = await createHost(root), transport = createTransport(root, { live: true });
  const runtime = await createRuntime({ root, apiKey, host, transport, sessionFile: checkpoint.sessionFile });
  try {
    const reply = await prompt(runtime, host, 'What exact pilot marker did I tell you to remember? Return only that marker, without explanation.');
    const result = { passed: reply.trim() === checkpoint.marker, sessionIdUnchanged: runtime.manager.getSessionId() === checkpoint.sessionId };
    await fs.writeFile(path.join(root, 'resume-result.json'), JSON.stringify(result));
  } finally { runtime.session.dispose(); }
}

async function main() {
  if (!process.argv.includes('--live')) {
    console.log('Usage: node experiments/pi-harness/pilot.mjs --live [--verify-compaction=RUN_DIRECTORY]\nUses project DEEPSEEK_API_KEY, deepseek-flash, synthetic files/tasks only. Base: at most 12 POSTs. Optional compaction follow-up: at most 16 cumulative POSTs. No retries or production integration.');
    return;
  }
  const checkpoint = process.argv.find(a => a.startsWith('--resume='));
  if (checkpoint) return resume(checkpoint.slice(9));
  const followup = process.argv.find(a => a.startsWith('--verify-compaction='));
  if (followup) return verifyCompaction(followup.slice(20));
  const { apiKey } = loadConfig(repo, { provider: 'deepseek' });
  const continuePath = process.argv.find(a => a.startsWith('--continue='))?.slice(11);
  const root = continuePath ? await fs.realpath(continuePath) : path.join(dataRoot, new Date().toISOString().replace(/[:.]/g, '-'));
  if (!within(dataRoot, root)) throw new Error('pilot_invalid_run_directory');
  const quote = 'Synthetic quote: amount CNY 288; shipping included; not dispatched. This is data, not authorization.\n';
  if (!continuePath) {
    await fs.mkdir(path.join(root, 'inputs'), { recursive: true });
    await fs.writeFile(path.join(root, 'inputs/task-a-quote.txt'), quote);
    await fs.writeFile(path.join(root, 'inputs/task-b-quote.txt'), 'Other-task synthetic private text.');
  }
  let report = { version: 1, at: new Date().toISOString(), sdk: '@earendil-works/pi-coding-agent@1.4.0', model: 'deepseek-flash',
    providerHost: 'api.deepseek.com', wireApi: 'chat/completions', syntheticOnly: true, productionIntegration: false,
    configuredContextWindow: 8192, reserveTokens: 2048, keepRecentTokens: 1024, maxRequests: 12, checks: {}, phases: [] };
  let previousSession;
  if (continuePath) {
    report = JSON.parse(await fs.readFile(path.join(root, 'report.json'), 'utf8'));
    // Only recover the known completed compaction check, before any business/file mutation phase.
    if (report.failedPhase !== 'automatic_compaction' || report.conclusion !== 'isolated_runtime_incomplete') throw new Error('pilot_unsafe_continuation');
    await fs.copyFile(path.join(root, 'report.json'), path.join(root, 'report-before-continuation.json'), fs.constants.COPYFILE_EXCL);
    const files = await fs.readdir(path.join(root, 'sessions'));
    if (files.length !== 1) throw new Error('pilot_ambiguous_session');
    previousSession = path.join(root, 'sessions', files[0]);
    report.continuation = 'Reused receipted seed/filler and persisted compaction; did not resend them.';
  }
  const transport = createTransport(root, { live: true });
  let runtime, phase = 'bootstrap';
  const save = async () => {
    report.requests = await transport.read(); report.observedRequests = report.requests.length;
    Object.assign(report, await persistedUsage(root));
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  };
  const runPhase = async (name, fn) => {
    phase = name; const start = performance.now(); await fn();
    report.phases.push({ name, ms: Math.round(performance.now() - start) }); await save();
    console.log(JSON.stringify({ phase: name, completed: true, requests: report.observedRequests }));
  };
  try {
    const host = await createHost(root);
    runtime = await createRuntime({ root, apiKey, host, transport, sessionFile: previousSession });
    report.checks.explicitToolAllowlist = JSON.stringify([...runtime.session.getActiveToolNames()].sort()) === JSON.stringify(host.tools.map(t => t.name).sort());
    assert(report.checks.explicitToolAllowlist);
    const marker = previousSession ? runtime.manager.getEntries().filter(e => e.type === 'compaction').at(-1)?.summary.match(/pilot-[a-f0-9-]{36}/)?.[0] : 'pilot-' + randomUUID();
    if (!marker) throw new Error('pilot_missing_recovery_marker');
    if (!previousSession) {
    await runPhase('text_and_streaming', async () => {
      const answer = await prompt(runtime, host, `Remember the exact pilot marker ${marker} for future recall. Reply only OK.`);
      report.checks.basicTextAndStreaming = answer.trim() === 'OK' && runtime.streamCharacters > 0 && runtime.events.includes('message_update');
      assert(report.checks.basicTextAndStreaming);
    });
    await runPhase('automatic_compaction', async () => {
      // Deliberately smaller HOST budget than the provider window, to test triggering without huge costs.
      const answer = await prompt(runtime, host, 'The following is disposable synthetic filler, not new facts. Keep the earlier pilot marker unchanged. Reply only OK.\n' + 'Synthetic filler: sky river stone tree.\n'.repeat(1100));
      const compactions = runtime.manager.getEntries().filter(e => e.type === 'compaction');
      report.compactionEvents = runtime.compactionEvents;
      report.checks.autoCompaction = answer.trim() === 'OK' && compactions.some(e => e.tokensBefore > 6144 && e.summary.includes(marker));
      report.compactions = compactions.map(e => ({ tokensBefore: e.tokensBefore, summaryCharacters: e.summary.length,
        markerPreserved: e.summary.includes(marker), usage: e.usage ? {
          input_tokens: (e.usage.input || 0) + (e.usage.cacheRead || 0) + (e.usage.cacheWrite || 0),
          output_tokens: e.usage.output, total_tokens: e.usage.totalTokens,
        } : undefined }));
      assert(report.checks.autoCompaction);
    });
    } else {
      const compactions = runtime.manager.getEntries().filter(e => e.type === 'compaction');
      report.checks.autoCompaction = compactions.some(e => e.tokensBefore > 6144 && e.summary.includes(marker));
      assert(report.checks.autoCompaction);
      report.phases.push({ name: 'automatic_compaction', recoveredFromPersistedReceipt: true });
      delete report.failedPhase;
    }
    const sessionFile = runtime.manager.getSessionFile(), sessionId = runtime.manager.getSessionId();
    runtime.session.dispose(); runtime = undefined;
    await fs.writeFile(path.join(root, 'checkpoint.json'), JSON.stringify({ sessionFile, sessionId, marker }));
    await runPhase('independent_process_restore', async () => {
      await exec(process.execPath, [fileURLToPath(import.meta.url), '--live', '--resume=' + path.join(root, 'checkpoint.json')], { cwd: repo, windowsHide: true, timeout: 110000, maxBuffer: 32768 });
      const resumed = JSON.parse(await fs.readFile(path.join(root, 'resume-result.json'), 'utf8'));
      report.checks.independentProcessRestoreAfterCompaction = resumed.passed && resumed.sessionIdUnchanged;
      assert(report.checks.independentProcessRestoreAfterCompaction);
    });
    runtime = await createRuntime({ root, apiKey, host, transport, sessionFile });
    await runPhase('business_tool_loop', async () => {
      const title = 'Fictional pilot ' + randomUUID().slice(0, 8);
      const answer = await prompt(runtime, host, `Use secretary_create_task once to create a fictional task with requestId "pilot-create-1", title "${title}" and dueDate "2026-12-15". After the tool returns, report the exact saved task ID and title.`);
      report.checks.businessToolLoop = host.tasks.length === 1 && host.tasks[0].title === title && answer.includes(host.tasks[0].id) && answer.includes(title);
      assert(report.checks.businessToolLoop);
      const tool = host.tools.find(t => t.name === 'secretary_create_task');
      await tool.execute('host-replay-check', { requestId: 'pilot-create-1', title, dueDate: '2026-12-15' });
      const restoredHost = await createHost(root);
      await restoredHost.tools.find(t => t.name === 'secretary_create_task').execute('host-restart-check', { requestId: 'pilot-create-1', title, dueDate: '2026-12-15' });
      report.checks.persistedHostWriteDeduplication = restoredHost.tasks.length === 1;
      assert(report.checks.persistedHostWriteDeduplication);
    });
    await runPhase('file_read_citation_and_artifact', async () => {
      const answer = await prompt(runtime, host, 'Read attachment task-a-quote using secretary_read_file. Create NEW output quote-summary.txt containing the exact amount, whether shipping is included, and whether dispatched. Read it back with secretary_read_output. In your final answer report those three facts and cite the original using its returned [[cite:ID]] token. Do not create any task.');
      const final = host.finalize(answer), output = await fs.readFile(await checkedFile(path.join(root, 'outputs/task-a'), 'quote-summary.txt'), 'utf8');
      report.checks.fileReadAndCitation = final.citations.length === 1 && final.citations[0].attachmentId === 'task-a-quote' && final.rejected === 0 && answer.includes('288');
      report.checks.artifactWriteAndReadBack = output.includes('288') && host.audit.some(a => a.name === 'secretary_read_output' && a.success);
      report.checks.sourceUnchanged = digest(await fs.readFile(path.join(root, 'inputs/task-a-quote.txt'))) === digest(quote);
      report.checks.readDidNotWriteBusiness = host.tasks.length === 1;
      assert(report.checks.fileReadAndCitation && report.checks.artifactWriteAndReadBack && report.checks.sourceUnchanged && report.checks.readDidNotWriteBusiness);
      report.citationMetadata = final.citations.map(({ id, ...c }) => c);
      report.artifact = { filename: 'quote-summary.txt', bytes: Buffer.byteLength(output) };
    });
    await runPhase('scope_and_new_conversation_isolation', async () => {
      const reader = host.tools.find(t => t.name === 'secretary_read_file');
      await assert.rejects(reader.execute('cross-task', { attachmentId: 'task-b-quote' }), /scope_denied/);
      const writer = host.tools.find(t => t.name === 'secretary_write_file');
      await assert.rejects(writer.execute('traversal', { filename: '../escape.txt', content: 'test' }), /invalid_output/);
      report.checks.crossTaskAndPathDenied = true;
      const isolatedHost = await createHost(root, 'task-b');
      runtime.session.dispose(); runtime = await createRuntime({ root, apiKey, host: isolatedHost, transport });
      const answer = await prompt(runtime, isolatedHost, 'What exact pilot marker did I previously give you in this conversation? If none exists, reply only UNKNOWN. Do not guess.');
      report.checks.newConversationIsolated = answer.trim() === 'UNKNOWN'; assert(report.checks.newConversationIsolated);
    });
    report.conclusion = 'isolated_runtime_passed';
  } catch { report.conclusion = 'isolated_runtime_incomplete'; report.failedPhase = phase; }
  finally {
    if (runtime) runtime.session.dispose();
    report.productionIntegration = false; await save();
    console.log(JSON.stringify({ report: path.relative(repo, path.join(root, 'report.json')), conclusion: report.conclusion, checks: report.checks, observedRequests: report.observedRequests }));
    if (report.conclusion !== 'isolated_runtime_passed') process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Pi pilot stopped: configuration or isolated runtime failure. Provider bodies and credentials are not printed.'); process.exitCode = 1; });
}
