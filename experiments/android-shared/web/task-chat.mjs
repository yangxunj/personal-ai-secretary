import { runPilotAgent } from './pi-runtime.mjs';
import { newConversation, parseConversation, recoverConversation, conversationHistory, beginConversationTurn,
  recordConversationMessage, finishConversationTurn, interruptedNotice } from '../../../src/lib/pi/conversation.mjs';
import { publicWebUrl } from '../../../src/lib/web-search/url.mjs';

const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('');

export function attachTaskChat(document, host, tasks, ai, refresh) {
  const bridge = host.SecretaryStorage, panel = document.querySelector('.task-chat-panel');
  const form = document.getElementById('task-chat-form'), status = document.getElementById('task-chat-status');
  const send = document.getElementById('task-chat-send'), cancel = document.getElementById('task-chat-cancel');
  const transcript = host.PilotMessageUI.createTranscript(document.getElementById('task-chat-messages'), url => {
    try { bridge.openWebLink(publicWebUrl(url)); } catch { status.textContent = '无法打开此链接。'; }
  });
  const decode = raw => { const result = JSON.parse(raw); if (!result.ok) throw new Error('任务对话读取或保存失败，请重试。'); return result.data; };
  let taskId, current, draft = '', archived = false, healthy = true, running;
  const input = host.PilotMessageUI.createTaskChatInput(document.getElementById('task-chat-composer'), {
    onDraftChange(value) {
      draft = value;
      if (!running && healthy && !archived && current) {
        try { save({ ...current.snapshot, draft }); } catch { healthy = false; status.textContent = '草稿保存失败，请重新打开任务；输入仍保留。'; }
      }
      renderInput();
    },
    onSend() { if (!running && healthy && !archived && draft.trim()) form.requestSubmit(send); },
  });
  function save(snapshot) {
    const next = parseConversation(snapshot);
    const row = decode(bridge.saveTaskConversation(taskId, next.id, current?.version || 0, JSON.stringify(next)));
    current = { version: row.version, snapshot: parseConversation(row.snapshot) };
  }
  function renderInput() {
    const disabled = archived || !healthy || !current;
    input.render({ draft, busy: !!running, disabled });
    send.disabled = disabled || !!running || !draft.trim();
  }
  function render() {
    transcript.render(current?.snapshot.turns || [], interruptedNotice);
    draft = current?.snapshot.draft || ''; renderInput();
    panel.dataset.readonly = String(archived);
    form.hidden = archived; document.getElementById('task-chat-readonly').hidden = !archived;
    host.requestAnimationFrame(() => { if (!panel.hidden) panel.scrollTop = panel.scrollHeight; });
  }
  function open(id) {
    if (running) return id === taskId;
    taskId = id; current = null; draft = ''; status.textContent = '';
    try {
      const task = decode(bridge.readTask(id)); if (!task) throw new Error('任务不存在。');
      archived = task.archivedAt != null;
      const stored = decode(bridge.readTaskConversation(id));
      if (stored) {
        current = { version: stored.version, snapshot: recoverConversation(stored.snapshot) };
        if (!archived && stored.snapshot.turns.some(turn => turn.status === 'running')) save(current.snapshot);
      } else if (!archived) {
        const snapshot = newConversation(nonce(), 'deepseek'); snapshot.title = task.title.slice(0, 80); save(snapshot);
      }
      healthy = true; render(); return true;
    } catch { healthy = false; status.textContent = '无法打开任务对话，请重新打开任务后重试。'; render(); return false; }
  }
  cancel.addEventListener('click', () => running?.abort());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (running || !healthy || archived || !current || !draft.trim()) return;
    if (document.querySelector('input[name="ai-mode"]:checked')?.value !== 'deepseek') { status.textContent = '请先在设置中选择 DeepSeek。'; return; }
    if (!bridge.hasApiKey?.()) { status.textContent = '请先在设置中填写 DeepSeek 密钥。'; return; }
    const controller = new AbortController();
    if (!ai.beginTask(controller)) { status.textContent = '另一段对话正在处理，请等待完成。'; return; }
    running = controller; cancel.hidden = false; status.textContent = '正在连接 DeepSeek…'; renderInput();
    let started = false; const currentTaskId = taskId;
    try {
      tasks.readScoped(currentTaskId);
      const turnId = nonce(), prompt = draft.trim(), history = conversationHistory(current.snapshot);
      save(beginConversationTurn(current.snapshot, turnId, prompt)); started = true; render();
      const result = await runPilotAgent({ prompt, history, turnId, signal: controller.signal,
        taskScope: { read: () => tasks.readScoped(currentTaskId), update: (key, args) => tasks.updateScoped(key, currentTaskId, args) },
        modelRequest: ai.request, webRequest: ai.webRequest,
        onEvent(event) {
          if (event.type === 'message_end') save(recordConversationMessage(current.snapshot, event.message));
          if (event.type === 'tool_execution_start') status.textContent = ({ getCurrentTask: '正在读取任务…', updateCurrentTask: '正在更新任务…', webSearch: '正在联网搜索…', fetchWebPage: '正在读取网页…' })[event.toolName] || '正在处理…';
          if (event.type === 'tool_execution_end') status.textContent = event.isError ? '工具未完成，正在整理结果…' : '正在整理回答…';
        },
      });
      save(finishConversationTurn(current.snapshot, result.reply, true)); started = false; status.textContent = ''; render();
    } catch (error) {
      if (started) try { save(finishConversationTurn(current.snapshot, '', false)); render(); } catch { healthy = false; }
      status.textContent = (controller.signal.aborted ? '本轮已取消。' : error.message || '本轮未完成。') + ' 请先检查任务结果；草稿仍保留。';
    } finally {
      running = undefined; cancel.hidden = true; ai.endTask(controller);
      try { refresh(); } catch {} renderInput();
    }
  });
  return { open, get busy() { return !!running; } };
}
