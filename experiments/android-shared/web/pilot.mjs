// This is the same module used by the existing web/Windows collection service.
import { parseDefinition, validateValues, collectionError, MAX_RECORDS } from '../../../src/lib/collections/schema.ts';

export const definition = parseDefinition({
  title: '平板书单', view: 'cards', titleFieldId: 'name', fields: [
    { id: 'name', label: '书名', type: 'text', required: true },
    { id: 'date', label: '阅读日期', type: 'date' },
    { id: 'status', label: '阅读状态', type: 'select', required: true, options: ['想读', '在读', '读完'] },
  ],
});

export function runRuleChecks() {
  const cases = [
    ['正常记录', { name: '小王子', date: '2024-02-29', status: '想读' }, null],
    ['书名必填', { name: ' ', status: '想读' }, 'required'],
    ['无效日期', { name: '测试', date: '2025-02-29', status: '想读' }, 'type'],
    ['状态范围', { name: '测试', status: '不存在' }, 'type'],
    ['未知字段', { name: '测试', status: '想读', other: true }, 'unknownField'],
    ['书名长度', { name: '书'.repeat(201), status: '想读' }, 'type'],
  ];
  return cases.map(([name, input, expected]) => {
    let actual = null;
    try { validateValues(definition, input); } catch (error) { actual = error.code || 'unexpected'; }
    return { name, passed: actual === expected, expected, actual };
  });
}

export function createRecords(storage) {
  return {
    list: () => storage.list(),
    append(input) {
      const values = validateValues(definition, input);
      if (storage.list().length >= MAX_RECORDS) throw new Error('试验记录已达上限。');
      return storage.append(values);
    },
  };
}

function decode(response) {
  const result = JSON.parse(response);
  if (!result.ok) throw new Error(result.error || '本地存储失败。');
  return result.data;
}

export function startPage(document, host) {
  const message = document.getElementById('message');
  const save = document.getElementById('save');
  const bridge = host.SecretaryStorage;
  const t = (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
  const showError = error => { message.className = ''; message.textContent = collectionError(error, t) === '操作未完成，请稍后重试。' ? '本地存储不可用，请重试；已填写内容仍保留。' : collectionError(error, t); };
  if (!bridge) { message.textContent = '请在安卓试验应用中打开；普通浏览器没有平板存储接口。'; return; }
  message.textContent = '';
  const records = createRecords({
    list: () => decode(bridge.listRecords()),
    append: values => decode(bridge.appendRecord(JSON.stringify(values))),
  });
  function refresh() {
    const rows = records.list();
    const list = document.getElementById('records');
    list.replaceChildren();
    for (const row of rows) {
      const item = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('small');
      title.textContent = row.values.name;
      detail.textContent = [row.values.status, row.values.date].filter(Boolean).join(' · ');
      item.append(title, detail); list.append(item);
    }
    document.getElementById('count').textContent = String(rows.length);
    document.getElementById('empty').hidden = rows.length > 0;
  }
  document.getElementById('record-form').addEventListener('submit', event => {
    event.preventDefault(); save.disabled = true;
    try {
      records.append({ name: document.getElementById('name').value, date: document.getElementById('date').value, status: document.getElementById('status').value });
      document.getElementById('record-form').reset();
      message.className = 'success'; message.textContent = '已保存到这台平板。';
      try { refresh(); }
      catch { message.textContent = '记录已保存，但列表读取失败。请点“重新读取”，无需重复保存。'; }
    } catch (error) { showError(error); }
    finally { save.disabled = false; }
  });
  document.getElementById('refresh').addEventListener('click', () => { try { refresh(); save.disabled = false; } catch (error) { showError(error); } });
  document.getElementById('verify').addEventListener('click', () => {
    document.getElementById('checks').textContent = runRuleChecks().map(row => `${row.passed ? '通过' : '失败'}：${row.name}`).join('\n');
  });
  try { refresh(); save.disabled = false; } catch (error) { showError(error); }
  // Debug instrumentation exercises the actual WebView bundle and native SQLite bridge.
  host.Pilot = { runRuleChecks, count: () => records.list().length, append: values => records.append(values) };
}

globalThis.PilotCore = { definition, validateValues, runRuleChecks, createRecords, startPage };
if (typeof document !== 'undefined') startPage(document, globalThis);
