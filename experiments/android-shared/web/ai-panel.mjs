import { runPilotAgent, demoModelRequest } from './pi-runtime.mjs';

const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('');

export function attachAiPanel(document, host, records, definition, refresh) {
  const form = document.getElementById('ai-form');
  const output = document.getElementById('ai-output');
  const events = document.getElementById('ai-events');
  const send = document.getElementById('ai-send');
  const cancel = document.getElementById('ai-cancel');
  const fields = document.getElementById('deepseek-fields');
  const bridge = host.SecretaryStorage;
  const pending = new Map();
  let active;
  const mode = () => document.querySelector('input[name="ai-mode"]:checked').value;
  const settingsChanged = () => { document.getElementById('key-state').textContent = bridge.hasApiKey?.() ? '已保存密钥；是否有效需实际请求确认。' : '尚未配置密钥。'; };
  host.SecretaryAI = {
    receive(id, response) {
      const request = pending.get(id);
      if (!request) return;
      try {
        const result = JSON.parse(response);
        if (!result.ok) throw new Error(result.error || '模型连接失败。');
        request.resolve(result.data);
      } catch (error) { request.reject(error); }
    },
    settingsChanged,
  };
  function nativeRequest(body, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = 'model-' + nonce();
      const cleanup = () => { pending.delete(id); clearTimeout(timer); signal.removeEventListener('abort', abort); };
      const abort = () => { bridge.cancelModelRequest(); cleanup(); reject(new Error('本轮已取消，请先检查已保存记录。')); };
      const timer = setTimeout(() => { bridge.cancelModelRequest(); cleanup(); reject(new Error('模型请求超时，请检查已保存记录。')); }, 90000);
      pending.set(id, { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); } });
      signal.addEventListener('abort', abort, { once: true });
      try { bridge.beginModelRequest(id, JSON.stringify(body)); }
      catch { cleanup(); reject(new Error('模型连接入口不可用，请安装新版测试包。')); }
    });
  }
  function showMode() {
    const real = mode() === 'deepseek';
    fields.hidden = !real; fields.disabled = !real;
    document.getElementById('demo-guide').hidden = real;
    send.textContent = real ? '发送给 DeepSeek' : '运行离线演练';
    settingsChanged();
  }
  for (const radio of document.querySelectorAll('input[name="ai-mode"]')) radio.addEventListener('change', showMode);
  document.getElementById('model-key').addEventListener('click', () => bridge.openModelSettings());
  cancel.addEventListener('click', () => active?.abort());
  document.addEventListener('visibilitychange', () => { if (document.hidden) active?.abort(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (active) return;
    const real = mode() === 'deepseek';
    const prompt = real ? document.getElementById('ai-prompt').value.trim() : '创建一条固定的离线演练书单。';
    if (real && !bridge.hasApiKey?.()) { output.textContent = '请先设置你自己的 DeepSeek 密钥。'; return; }
    if (!prompt) { output.textContent = '请填写请求。'; return; }
    if (typeof structuredClone !== 'function') { output.textContent = '当前 WebView 版本过旧，请先更新 Android System WebView。'; return; }
    active = new AbortController();
    send.disabled = true; cancel.hidden = false;
    document.getElementById('model-key').disabled = true;
    for (const radio of document.querySelectorAll('input[name="ai-mode"]')) radio.disabled = true;
    output.textContent = real ? '正在连接 DeepSeek…' : '正在运行固定演练，不调用模型…';
    events.replaceChildren();
    try {
      const result = await runPilotAgent({ prompt, records, definition,
        modelRequest: real ? nativeRequest : demoModelRequest(), signal: active.signal, turnId: nonce(),
        onEvent(event) {
          if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
            const item = document.createElement('li');
            const labels = { describeCollection: '读取栏目定义', readCollectionRecord: '读取记录', createCollectionRecord: '创建记录', updateCollectionRecord: '修改记录' };
            item.textContent = `${labels[event.toolName] || '工具操作'}：${event.type === 'tool_execution_start' ? '执行中' : event.isError ? '失败' : '已完成'}`;
            events.append(item);
            if (event.type === 'tool_execution_end') { try { refresh(); } catch {} }
          }
        },
      });
      output.textContent = result.reply;
      if (real) document.getElementById('ai-prompt').value = '';
    } catch (error) {
      output.textContent = (active.signal.aborted ? '本轮已取消。' : error.message || '本轮未完成。') + ' 已保存的工具结果保留，请先查看书单；请求草稿仍保留。';
    } finally {
      try { refresh(); } catch {}
      active = undefined; send.disabled = false; cancel.hidden = true;
      document.getElementById('model-key').disabled = false;
      for (const radio of document.querySelectorAll('input[name="ai-mode"]')) radio.disabled = false;
    }
  });
  showMode();
}
