import { runPilotAgent, demoModelRequest } from './pi-runtime.mjs';
import { attachConversationPanel } from './conversation-panel.mjs';
import { generateTitle, titleCandidate } from './title-work.mjs';

const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('');

export function attachAiPanel(document, host, records, definition, refresh, tasks, closeDrawer, setTasksBusy = () => {}) {
  const form = document.getElementById('ai-form');
  const output = document.getElementById('ai-output');
  const events = document.getElementById('ai-events');
  const send = document.getElementById('ai-send');
  const cancel = document.getElementById('ai-cancel');
  const bridge = host.SecretaryStorage;
  const pending = new Map();
  let active;
  const titleQueue = [], titleQueued = new Set();
  let titleActive;
  const conversations = attachConversationPanel(document, bridge, nonce, host.PilotMessageUI, () => form.requestSubmit(send), closeDrawer);
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
    request: nativeRequest,
  };
  function nativeRequest(body, signal) {
    return nativeTransport(null, body, signal);
  }
  function nativeWebRequest(kind, body, signal) {
    return nativeTransport(kind, body, signal);
  }
  function nativeTransport(kind, body, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = (kind === 'title' ? 'title-' : kind ? 'web-' : 'model-') + nonce();
      const cleanup = () => { pending.delete(id); clearTimeout(timer); signal.removeEventListener('abort', abort); };
      const cancelNative = () => kind === 'title' ? bridge.cancelTitleRequest() : bridge.cancelModelRequest();
      const abort = () => { cancelNative(); cleanup(); reject(new Error('本轮已取消，请先检查已保存记录。')); };
      const timer = setTimeout(() => { cancelNative(); cleanup(); reject(new Error('模型请求超时，请检查已保存记录。')); }, kind === 'title' ? 45000 : 90000);
      pending.set(id, { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); } });
      signal.addEventListener('abort', abort, { once: true });
      try {
        if (kind === 'title') bridge.beginTitleRequest(id, JSON.stringify(body));
        else if (kind) bridge.beginWebRequest(id, kind, JSON.stringify(body));
        else bridge.beginModelRequest(id, JSON.stringify(body));
      } catch { cleanup(); reject(new Error('请求入口不可用，请安装新版测试包。')); }
    });
  }
  function scheduleTitle(candidate) {
    if (!candidate || titleQueued.has(candidate.id) || document.hidden) return;
    titleQueued.add(candidate.id); titleQueue.push(candidate); void runTitleQueue();
  }
  async function runTitleQueue() {
    if (titleActive) return;
    while (titleQueue.length && !document.hidden) {
      const candidate = titleQueue.shift();
      titleActive = new AbortController();
      try {
        const row = JSON.parse(bridge.readConversation(candidate.id));
        const latest = row.ok && row.data && titleCandidate(row.data.snapshot);
        if (!latest || latest.expectedTitle !== candidate.expectedTitle || !bridge.claimTitleAttempt(candidate.id)) continue;
        const title = await generateTitle(latest, (body, signal) => nativeTransport('title', body, signal), titleActive.signal);
        if (conversations.applyTitle(candidate, title)) bridge.finishTitle(candidate.id);
      } catch { /* Keep the existing title and leave the conversation usable. */ }
      finally { titleQueued.delete(candidate.id); titleActive = undefined; }
    }
  }
  function showMode() {
    const real = mode() === 'deepseek';
    form.dataset.mode = real ? 'deepseek' : 'demo';
    document.getElementById('shared-composer').hidden = !real;
    document.getElementById('demo-guide').hidden = real;
    send.textContent = real ? '↑' : '运行离线演练';
    send.setAttribute('aria-label', real ? '发送' : '运行离线演练');
    settingsChanged();
    conversations.load(real ? 'deepseek' : 'demo');
  }
  for (const radio of document.querySelectorAll('input[name="ai-mode"]')) radio.addEventListener('change', showMode);
  document.getElementById('model-key').addEventListener('click', () => bridge.openModelSettings());
  cancel.addEventListener('click', () => active?.abort());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { active?.abort(); titleActive?.abort(); for (const item of titleQueue.splice(0)) titleQueued.delete(item.id); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (active) return;
    const real = mode() === 'deepseek';
    const prompt = real ? conversations.draft.trim() : '创建一条固定的离线演练待办。';
    if (real && !bridge.hasApiKey?.()) { output.textContent = '请先设置你自己的 DeepSeek 密钥。'; return; }
    if (!prompt) { output.textContent = '请填写请求。'; return; }
    if (typeof structuredClone !== 'function') { output.textContent = '当前 WebView 版本过旧，请先更新 Android System WebView。'; return; }
    active = new AbortController();
    try { setTasksBusy(true); } catch { /* The task view must not prevent chat from starting. */ }
    conversations.busy(true);
    send.disabled = true; cancel.hidden = false;
    document.getElementById('model-key').disabled = true;
    for (const radio of document.querySelectorAll('input[name="ai-mode"]')) radio.disabled = true;
    output.textContent = real ? '正在连接 DeepSeek…' : '正在运行固定演练，不调用模型…';
    events.replaceChildren();
    document.getElementById('message-link-status').textContent = '';
    let started = false;
    try {
      const turnId = nonce();
      const history = conversations.begin(turnId, prompt); started = true;
      const result = await runPilotAgent({ prompt, records, definition, tasks, history,
        modelRequest: real ? nativeRequest : demoModelRequest('tasks'), webRequest: real ? nativeWebRequest : undefined, signal: active.signal, turnId,
        onEvent(event) {
          if (event.type === 'message_end') conversations.record(event.message);
          if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
            const labels = { describeCollection: '读取栏目定义', readCollectionRecord: '读取记录', createCollectionRecord: '创建书单记录', updateCollectionRecord: '修改书单记录', createTask: '创建待办', listTasks: '查询待办', updateTask: '修改待办', webSearch: '联网搜索', fetchWebPage: '读取网页' };
            if (event.type === 'tool_execution_start') {
              const item = document.createElement('li');
              item.textContent = `${labels[event.toolName] || '工具操作'}：执行中`;
              output.textContent = ''; events.replaceChildren(item);
            } else {
              events.replaceChildren(); output.textContent = event.isError ? '工具未完成，正在整理结果…' : '正在整理回答…';
              try { refresh(); } catch {}
            }
          }
        },
      });
      events.replaceChildren(); output.textContent = '';
      conversations.finish(result.reply, true); started = false;
      if (real) scheduleTitle(conversations.titleCandidate());
    } catch (error) {
      events.replaceChildren();
      if (started) try { conversations.finish('本轮未完整结束。', false); } catch { conversations.fail(); }
      output.textContent = (active.signal.aborted ? '本轮已取消。' : error.message || '本轮未完成。') + ' 已保存的工具结果保留，请先查看待办和书单；请求草稿仍保留。';
    } finally {
      try { refresh(); } catch {}
      active = undefined; send.disabled = !conversations.healthy; cancel.hidden = true;
      try { setTasksBusy(false); } catch { /* Task controls will refresh when the panel is reopened. */ }
      conversations.busy(false);
      document.getElementById('model-key').disabled = false;
      for (const radio of document.querySelectorAll('input[name="ai-mode"]')) radio.disabled = false;
    }
  });
  showMode();
}
