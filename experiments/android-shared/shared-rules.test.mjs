import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourceUrl = new URL('../../src/lib/collections/schema.ts', import.meta.url);
const original = readFileSync(sourceUrl, 'utf8');
const compiled = ts.transpileModule(original, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const serverContext = vm.createContext({ exports: {}, require });
vm.runInContext(compiled, serverContext);
const server = serverContext.exports;
const serviceUrl = new URL('../../src/lib/collections/record-write.ts', import.meta.url);
const serviceContext = vm.createContext({ exports: {}, require: specifier => specifier === './schema' ? server : require(specifier) });
vm.runInContext(ts.transpileModule(readFileSync(serviceUrl, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, serviceContext);
const serverWrite = serviceContext.exports.prepareRecordWrite;
const taskContractsContext = vm.createContext({ exports: {}, require });
vm.runInContext(ts.transpileModule(readFileSync(new URL('../../src/lib/tasks/contracts.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, taskContractsContext);
const taskPolicyContext = vm.createContext({ exports: {}, require: specifier => specifier === './contracts' ? taskContractsContext.exports : require(specifier) });
vm.runInContext(ts.transpileModule(readFileSync(new URL('../../src/lib/tasks/policy.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, taskPolicyContext);
const serverTasks = taskPolicyContext.exports;
const browser = vm.createContext({ console, performance, structuredClone, AbortController, TextEncoder, TextDecoder, URL, URLSearchParams, setTimeout, clearTimeout }, { codeGeneration: { strings: false, wasm: false } });
vm.runInContext(readFileSync(new URL('web-dist/pilot.js', import.meta.url), 'utf8'), browser);
const core = browser.PilotCore;
const plain = value => JSON.parse(JSON.stringify(value));

test('Android bundle contains the exact current shared source and its rules pass', () => {
  const manifest = JSON.parse(readFileSync(new URL('web-dist/build-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.sharedSourceSha256, createHash('sha256').update(readFileSync(sourceUrl)).digest('hex'));
  assert.equal(manifest.bundleSha256, createHash('sha256').update(readFileSync(new URL('web-dist/pilot.js', import.meta.url))).digest('hex'));
  assert.equal(manifest.sharedServiceSha256, createHash('sha256').update(readFileSync(serviceUrl)).digest('hex'));
  for (const [field, source] of [
    ['sharedToolContractsSha256', 'collections/tool-contracts.ts'],
    ['taskContractsSha256', 'tasks/contracts.ts'],
    ['taskPolicySha256', 'tasks/policy.ts'],
    ['taskServiceSha256', 'tasks/service.ts'],
    ['conversationSha256', 'pi/conversation.mjs'],
    ['contextBudgetSha256', 'pi/context-budget.mjs'],
  ]) assert.equal(manifest[field], createHash('sha256').update(readFileSync(new URL('../../src/lib/' + source, import.meta.url))).digest('hex'));
  assert.equal(core.runRuleChecks().length, 10);
  assert.ok(core.runRuleChecks().every(row => row.passed));
});

test('Node and browser execute the same schema with matching normalization and errors', () => {
  const definition = server.parseDefinition(plain(core.definition));
  const cases = [
    { name: ' 小王子 ', status: '在读', date: '' },
    { name: '三体', status: '读完', date: '2024-02-29' },
    { name: '', status: '想读' },
    { name: '测试', status: '想读', date: '2025-02-29' },
    { name: '测试', status: '未知' },
    { name: '书'.repeat(201), status: '想读' },
    { name: '测试', status: '想读', undeclared: 1 },
  ];
  const outcome = (validate, def, input) => {
    try { return { values: plain(validate(def, input)) }; }
    catch (error) { return { code: error.code, field: error.field }; }
  };
  for (const input of cases) assert.deepEqual(outcome(server.validateValues, definition, input), outcome(core.validateValues, core.definition, input));
});

test('invalid records never reach platform storage and failed writes do not create success', () => {
  let writes = 0;
  const records = core.createRecords({ list: () => [], append: () => { writes++; throw new Error('disk full'); } });
  assert.throws(() => records.append({ name: '', status: '想读' }));
  assert.equal(writes, 0);
  assert.throws(() => records.append({ name: '测试', status: '想读' }), /disk full/);
  assert.equal(writes, 1);
});

test('storage adapter receives normalized values rather than raw form input', () => {
  let saved;
  const records = core.createRecords({ list: () => [], append: values => { saved = plain(values); return { id: 'synthetic', values }; } });
  const result = records.append({ name: ' 测试 ', status: '想读', date: '' });
  assert.equal(result.id, 'synthetic');
  assert.deepEqual(saved, { name: '测试', status: '想读' });
});

test('formal Node service and Android bundle share partial-update and conflict policy', () => {
  const current = { values: { name: '原书名', status: '在读', date: '2024-02-29' }, version: 2, archived: false };
  const definition = server.parseDefinition(plain(core.definition));
  for (const patch of [{ name: ' 新书名 ' }, { date: '' }, { unknown: '拒绝' }, null]) {
    const outcome = (write, def) => {
      try { return plain(write(def, patch, current, 2)); }
      catch (error) { return { code: error.code, field: error.field }; }
    };
    assert.deepEqual(outcome(serverWrite, definition), outcome(core.prepareRecordWrite, core.definition));
  }
  const updated = plain(core.prepareRecordWrite(core.definition, { name: '新书名' }, current, 2));
  assert.deepEqual(updated.values, { name: '新书名', status: '在读', date: '2024-02-29' });
  assert.equal(updated.searchText, '新书名\n2024-02-29\n在读');
  for (const write of [serverWrite, core.prepareRecordWrite]) {
    assert.throws(() => write(core.definition, { name: '覆盖' }, current, 1), error => error.code === 'conflict');
    assert.throws(() => write(core.definition, { name: '覆盖' }, { ...current, archived: true }, 2), error => error.code === 'conflict');
  }
});

test('Android edits preserve unmentioned fields and reject stale versions before writing', () => {
  const rows = [{ id: 'old-record', values: { name: '旧版保留记录', status: '想读', date: '2024-02-29' }, version: 1 }];
  let writes = 0;
  const records = core.createRecords({
    list: () => rows,
    update(id, version, values) { writes++; rows[0] = { id, version: version + 1, values: plain(values) }; return rows[0]; },
  });
  const result = records.update('old-record', 1, { status: '读完' });
  assert.equal(result.version, 2);
  assert.equal(result.values.name, '旧版保留记录');
  assert.equal(result.values.date, '2024-02-29');
  assert.throws(() => records.update('old-record', 1, { name: '过期编辑' }), error => error.code === 'conflict');
  assert.equal(writes, 1);
});

function agentFixture() {
  const rows = [], receipts = new Map();
  const storage = {
    list: () => rows,
    readReceipt(key, signature) {
      const prior = receipts.get(key);
      if (prior && prior.signature !== signature) throw new Error('receipt mismatch');
      return prior?.record;
    },
    commitTool(key, signature, operation) {
      let row;
      if (operation.kind === 'create') { row = { id: 'record-' + rows.length, version: 1, values: plain(operation.values) }; rows.push(row); }
      else { row = rows.find(row => row.id === operation.id); Object.assign(row, { version: row.version + 1, values: plain(operation.values) }); }
      receipts.set(key, { signature, record: plain(row) }); return row;
    },
  };
  return { rows, receipts, records: core.createRecords(storage) };
}

test('unmodified upstream Pi loop runs with CSP code generation disabled and writes through shared policy', async () => {
  const fixture = agentFixture(), events = [];
  const result = await core.runPilotAgent({ prompt: 'offline rehearsal', records: fixture.records, definition: core.definition, modelRequest: core.demoModelRequest(), signal: new AbortController().signal, turnId: 'test-turn', onEvent: event => events.push(event.type) });
  assert.match(result.reply, /没有调用 AI/);
  assert.equal(fixture.rows.length, 1, JSON.stringify(result.messages));
  assert.equal(fixture.rows[0].values.name, 'Pi离线演练书单');
  assert.ok(events.includes('tool_execution_end'));
  assert.ok(events.includes('agent_end'));
  assert.equal(fixture.receipts.size, 1);
});

test('repeated tool IDs return committed receipt instead of duplicating records; changed arguments are refused', () => {
  const fixture = agentFixture();
  const args = { collectionId: 'tablet-books', schemaVersion: 1, values: { name: '一次写入', status: '想读' } };
  const first = fixture.records.toolWrite('turn:call', 'createCollectionRecord', args);
  const second = fixture.records.toolWrite('turn:call', 'createCollectionRecord', args);
  assert.equal(first.id, second.id);
  assert.equal(fixture.rows.length, 1);
  assert.throws(() => fixture.records.toolWrite('turn:call', 'createCollectionRecord', { ...args, values: { ...args.values, name: '另一笔' } }), /receipt mismatch/);
});

test('Pi rejects invalid tool values and cancelled turns without a write', async () => {
  const fixture = agentFixture();
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(core.runPilotAgent({ prompt: 'cancelled', records: fixture.records, definition: core.definition, modelRequest: core.demoModelRequest(), signal: cancelled.signal, turnId: 'cancelled' }));
  assert.equal(fixture.rows.length, 0);
  let requests = 0;
  await core.runPilotAgent({ prompt: 'bad input', records: fixture.records, definition: core.definition, signal: new AbortController().signal, turnId: 'invalid', modelRequest: async () => {
    if (++requests === 1) return { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'bad', function: { name: 'createCollectionRecord', arguments: JSON.stringify({ collectionId: 'tablet-books', schemaVersion: 1, values: { name: '', status: '想读' } }) } }] } }] };
    return { choices: [{ finish_reason: 'stop', message: { content: '写入失败。' } }] };
  } });
  assert.equal(fixture.rows.length, 0);
  assert.equal(fixture.receipts.size, 0);
});

test('upstream Pi does not execute tool calls from a truncated model response', async () => {
  const fixture = agentFixture(); let step = 0;
  await core.runPilotAgent({ prompt: 'truncated', records: fixture.records, definition: core.definition, signal: new AbortController().signal, turnId: 'truncated', modelRequest: async () => {
    if (++step === 1) return { choices: [{ finish_reason: 'length', message: { content: null, tool_calls: [{ id: 'partial', function: { name: 'createCollectionRecord', arguments: JSON.stringify({ collectionId: 'tablet-books', schemaVersion: 1, values: { name: '不应保存', status: '想读' } }) } }] } }] };
    return { choices: [{ finish_reason: 'stop', message: { content: '上轮截断，未保存。' } }] };
  } });
  assert.equal(fixture.rows.length, 0);
  assert.equal(fixture.receipts.size, 0);
});

test('cancelling after a committed tool keeps that receipt and prevents later model requests', async () => {
  const fixture = agentFixture(), controller = new AbortController();
  let writes = 0, requests = 0;
  const transport = core.demoModelRequest();
  await assert.rejects(core.runPilotAgent({ prompt: 'cancel after write', records: fixture.records, definition: core.definition, signal: controller.signal, turnId: 'committed', modelRequest: async (...args) => { requests++; return transport(...args); }, onEvent: event => {
    if (event.type === 'tool_execution_end' && event.toolName === 'createCollectionRecord' && !event.isError) { writes++; controller.abort(); }
  } }));
  assert.equal(writes, 1);
  assert.equal(requests, 2);
  assert.equal(fixture.rows.length, 1);
  assert.equal(fixture.receipts.size, 1);
});

test('model network access is explicit while browser connections and remote frames remain blocked', () => {
  const manifest = readFileSync(new URL('android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  const html = readFileSync(new URL('web/index.html', import.meta.url), 'utf8');
  assert.match(manifest, /<uses-permission[^>]+android\.permission\.INTERNET/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /frame-src 'none'/);
});

function taskFixture() {
  const rows = [], receipts = new Map();
  const storage = {
    list: plan => rows.filter(row => plan.statuses.includes(row.status) && (!plan.category || row.category === plan.category) && (!plan.keyword || row.title.includes(plan.keyword))).slice(0, plan.limit),
    read: id => rows.find(row => row.id === id),
    create(data) { const row = { ...plain(data), id: 'task-' + rows.length, version: 1 }; rows.push(row); return row; },
    update(id, version, patch) { const row = this.read(id); if (row.version !== version) throw new Error('conflict'); Object.assign(row, plain(patch), { version: version + 1 }); return row; },
    readReceipt(key, signature) { const prior = receipts.get(key); if (prior && prior.signature !== signature) throw new Error('receipt mismatch'); return prior?.row; },
    commitTool(key, signature, operation) { const row = operation.kind === 'task-create' ? this.create(operation.values) : this.update(operation.id, operation.expectedVersion, operation.values); receipts.set(key, { signature, row: plain(row) }); return row; },
  };
  return { rows, receipts, storage, tasks: core.createTasks(storage) };
}

test('shared task workflows propagate storage failures and never turn missing tasks into successful writes', async () => {
  const fixture = taskFixture();
  assert.equal(fixture.tasks.toolWrite('missing', 'updateTask', { id: 'missing', status: 'done' }).ok, false);
  assert.equal(fixture.receipts.size, 0);
  assert.throws(() => fixture.tasks.update({ id: 'missing', status: 'done' }), /missing/);
  const row = fixture.tasks.create({ title: 'Keep original' });
  fixture.storage.commitTool = () => { throw new Error('synthetic disk full'); };
  assert.throws(() => fixture.tasks.toolWrite('failed', 'updateTask', { id: row.id, status: 'done' }), /disk full/);
  assert.equal(row.status, 'todo'); assert.equal(fixture.receipts.size, 0);
  const asyncTasks = core.createTasks({ ...fixture.storage,
    list: async () => { throw new Error('synthetic read failure'); },
    read: async () => row,
    update: async () => { throw new Error('synthetic version conflict'); },
  });
  await assert.rejects(asyncTasks.listTasks({}), /read failure/);
  await assert.rejects(asyncTasks.updateTask({ id: row.id, status: 'done' }), /version conflict/);
  assert.equal(row.status, 'todo');
});

test('shared task policy preserves original text, default values and omitted patch fields', () => {
  const created = plain(core.taskPolicy.prepareTaskCreate({ title: ' 原始标题 ', detail: '原始要求\nExact text', owner: '  测试成员  ', dueDate: '2026-11-09' }));
  assert.deepEqual(created, { title: ' 原始标题 ', detail: '原始要求\nExact text', owner: '测试成员', dueDate: '2026-11-09T00:00:00.000Z', category: '其他', priority: 2, status: 'todo', result: null });
  assert.deepEqual(plain(core.taskPolicy.prepareTaskUpdate({ id: 'task', status: 'done', owner: '' })), { status: 'done', owner: null });
  assert.deepEqual(plain(core.taskPolicy.prepareTaskQuery({})), { statuses: ['todo','doing','blocked'], category: null, keyword: null, limit: 20 });
  assert.throws(() => core.taskPolicy.prepareTaskCreate({ title: 'bad date', dueDate: 'invalid' }));
  assert.throws(() => core.taskPolicy.prepareTaskQuery({ limit: 51 }));
});

test('Node and Android bundle execute matching task policies for create, partial updates, queries and public dates', () => {
  const cases = {
    prepareTaskCreate: [
      { title: ' 原始标题 ', detail: '原文\nExact text', dueDate: '2026-11-09', owner: ' 测试成员 ' },
      { title: '无期限' }, { title: '空日期', dueDate: '' },
      { title: '无效日期', dueDate: 'invalid' }, { title: '未知类别', category: '未知' },
    ],
    prepareTaskUpdate: [
      { id: 'task', status: 'done' }, { id: 'task', owner: '' },
      { id: 'task', dueDate: '' }, { id: 'task', detail: '原文' },
      { id: 'task', dueDate: '2026-11-09' }, { id: 'task', priority: 4 },
    ],
    prepareTaskQuery: [{}, { status: 'done' }, { keyword: '', limit: 50 }, { status: 'doing', category: '其他', keyword: '原文' }, { limit: 51 }],
    taskPublicDto: [{ id: 'task', title: '原文', detail: null, status: 'todo', category: '其他', priority: 2, dueDate: '2026-11-09T00:00:00.000Z', result: null, owner: null }],
  };
  const outcome = (policy, method, input) => {
    try { return { value: plain(policy[method](input)) }; }
    catch (error) { return { error: error.message }; }
  };
  for (const [method, inputs] of Object.entries(cases)) for (const input of inputs) {
    assert.deepEqual(outcome(serverTasks, method, input), outcome(core.taskPolicy, method, input), `${method}: ${JSON.stringify(input)}`);
  }
});

test('upstream Pi creates, queries and completes a task through the same formal task contracts', async () => {
  const fixture = taskFixture(), books = agentFixture(); let step = 0;
  const result = await core.runPilotAgent({ prompt: 'create then finish', tasks: fixture.tasks, records: books.records, definition: core.definition, signal: new AbortController().signal, turnId: 'task-turn', modelRequest: async body => {
    const call = (name, args) => ({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'task-call-' + step, function: { name, arguments: JSON.stringify(args) } }] } }] });
    step++;
    if (step === 1) return call('createTask', { title: '明确任务要求', detail: '保留原文，不改写。' });
    if (step === 2) return call('listTasks', { keyword: '明确任务要求' });
    if (step === 3) {
      const queried = JSON.parse(body.messages.filter(message => message.role === 'tool').at(-1).content);
      assert.equal(queried.count, 1);
      return call('updateTask', { id: queried.tasks[0].id, status: 'done', result: '完成' });
    }
    return { choices: [{ finish_reason: 'stop', message: { content: '已完成测试任务。' } }] };
  } });
  assert.equal(result.reply, '已完成测试任务。');
  assert.equal(fixture.rows.length, 1);
  assert.equal(fixture.rows[0].status, 'done'); assert.equal(fixture.rows[0].detail, '保留原文，不改写。');
  assert.equal(fixture.tasks.list({}).length, 0); assert.equal(fixture.tasks.list({ status: 'done' }).length, 1);
  assert.equal(fixture.receipts.size, 2); assert.equal(books.rows.length, 0);
});

test('offline task rehearsal and task receipt replay do not duplicate one tool write', async () => {
  const fixture = taskFixture(), books = agentFixture();
  const result = await core.runPilotAgent({ prompt: 'demo', tasks: fixture.tasks, records: books.records, definition: core.definition, signal: new AbortController().signal, turnId: 'task-demo', modelRequest: core.demoModelRequest('tasks') });
  assert.match(result.reply, /创建并查到/); assert.equal(fixture.rows.length, 1);
  const args = { title: '一次任务', detail: '保留' };
  fixture.tasks.toolWrite('same:task', 'createTask', args); fixture.tasks.toolWrite('same:task', 'createTask', args);
  assert.equal(fixture.rows.length, 2);
  assert.throws(() => fixture.tasks.toolWrite('same:task', 'createTask', { title: '换内容' }), /mismatch/);
});

test('Pi follow-up receives prior tool IDs/results after JSON persistence without replaying a write', async () => {
  const fixture = taskFixture(), books = agentFixture(), policy = core.conversation;
  let snapshot = policy.newConversation('chat-one', 'deepseek');
  snapshot = policy.beginConversationTurn(snapshot, 'turn-one', '新增待办：检查预约');
  const first = await core.runPilotAgent({ prompt: '新增待办：检查预约', tasks: fixture.tasks, records: books.records, definition: core.definition,
    turnId: 'turn-one', signal: new AbortController().signal, modelRequest: core.demoModelRequest('tasks'),
    onEvent: event => { if (event.type === 'message_end') snapshot = policy.recordConversationMessage(snapshot, event.message); } });
  snapshot = policy.finishConversationTurn(snapshot, first.reply, true);
  snapshot = policy.recoverConversation(plain(snapshot));
  const history = policy.conversationHistory(snapshot);
  const second = await core.runPilotAgent({ prompt: '刚才那件事是什么？', tasks: fixture.tasks, records: books.records, definition: core.definition,
    history, turnId: 'turn-two', signal: new AbortController().signal, modelRequest: async body => {
      assert.ok(body.messages.some(message => message.role === 'user' && message.content.includes('新增待办')));
      assert.ok(body.messages.some(message => message.role === 'tool' && JSON.parse(message.content).ok));
      const assistant = body.messages.find(message => message.tool_calls?.length);
      assert.ok(body.messages.some(message => message.tool_call_id === assistant.tool_calls[0].id));
      return { choices: [{ finish_reason: 'stop', message: { content: '刚才创建了安卓待办演练。' } }] };
    } });
  assert.match(second.reply, /刚才/); assert.equal(fixture.rows.length, 1);
  assert.equal(policy.conversationHistory(policy.newConversation('chat-two', 'deepseek')).length, 0);
});

test('interrupted conversations retain draft and receipts but omit incomplete tool messages from future API context', async () => {
  const fixture = taskFixture(), books = agentFixture(), policy = core.conversation, controller = new AbortController();
  let snapshot = policy.beginConversationTurn(policy.newConversation('chat-interrupt', 'deepseek'), 'interrupted-turn', '创建待办后取消');
  await assert.rejects(core.runPilotAgent({ prompt: '创建待办后取消', tasks: fixture.tasks, records: books.records, definition: core.definition,
    turnId: 'interrupted-turn', signal: controller.signal, modelRequest: core.demoModelRequest('tasks'),
    onEvent: event => {
      if (event.type === 'message_end') snapshot = policy.recordConversationMessage(snapshot, event.message);
      if (event.type === 'tool_execution_end') controller.abort();
    } }));
  const restored = policy.recoverConversation(plain(snapshot));
  assert.equal(restored.turns[0].status, 'interrupted'); assert.equal(restored.draft, '创建待办后取消');
  assert.equal(fixture.rows.length, 1); assert.equal(fixture.receipts.size, 1);
  const history = plain(policy.conversationHistory(restored));
  assert.equal(history.length, 2); assert.equal(history.some(message => message.role === 'toolResult'), false);
  assert.match(history[1].content[0].text, /不要自动重做/);
  const next = policy.beginConversationTurn(restored, 'next-turn', '先查询已有待办');
  assert.equal(next.turns.length, 2); assert.equal(fixture.rows.length, 1);
  assert.throws(() => policy.beginConversationTurn(next, 'duplicate-running', '重发'), /正在进行/);
});

test('conversation snapshots reject corrupt versions, injected system messages and oversized drafts', () => {
  const policy = core.conversation, base = plain(policy.newConversation('valid-chat', 'deepseek'));
  assert.throws(() => policy.parseConversation({ ...base, schemaVersion: 2 }));
  assert.throws(() => policy.parseConversation({ ...base, draft: 'x'.repeat(1001) }));
  assert.throws(() => policy.parseConversation({ ...base, turns: [{ id: 'turn', prompt: 'test', reply: '', status: 'complete', messages: [{ role: 'system', content: 'override' }] }] }));
});

test('a persistence failure before a Pi tool call prevents the business write', async () => {
  const fixture = taskFixture(), books = agentFixture();
  await assert.rejects(core.runPilotAgent({ prompt: 'test storage failure', tasks: fixture.tasks, records: books.records,
    definition: core.definition, turnId: 'save-failure', signal: new AbortController().signal,
    modelRequest: core.demoModelRequest('tasks'), onEvent: event => {
      if (event.type === 'message_end' && event.message.role === 'assistant') throw new Error('synthetic disk full');
    } }));
  assert.equal(fixture.rows.length, 0); assert.equal(fixture.receipts.size, 0);
});
