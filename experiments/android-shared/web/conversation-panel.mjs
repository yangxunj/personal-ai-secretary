import { newConversation, parseConversation, recoverConversation, conversationHistory, beginConversationTurn,
  recordConversationMessage, finishConversationTurn, interruptedNotice } from '../../../src/lib/pi/conversation.mjs';

export function attachConversationPanel(document, bridge, nonce, messageUi) {
  const select = document.getElementById('conversation-select'), prompt = document.getElementById('ai-prompt');
  const status = document.getElementById('conversation-status'), list = document.getElementById('conversation-messages');
  const create = document.getElementById('conversation-new');
  if (!messageUi?.createTranscript) throw new Error('共用消息界面未加载，请重新打开应用。');
  const transcript = messageUi.createTranscript(list, () => { document.getElementById('message-link-status').textContent = '此试验版暂不打开外部链接。'; });
  let current, mode, busy = false, healthy = true;
  const decode = raw => { const result = JSON.parse(raw); if (!result.ok) throw new Error('会话保存或读取失败，请重新打开应用后检查。'); return result.data; };
  const fail = () => { healthy = false; status.textContent = '会话存储不可用，已停止发送。草稿保留，请重新打开应用后检查。'; document.getElementById('ai-send').disabled = true; };
  const clearTransient = () => { document.getElementById('ai-output').textContent = ''; document.getElementById('ai-events').replaceChildren(); document.getElementById('message-link-status').textContent = ''; };
  function save(snapshot) {
    const next = parseConversation(snapshot);
    const saved = decode(bridge.saveConversation(next.id, current?.version || 0, JSON.stringify(next)));
    current = { version: saved.version, snapshot: parseConversation(saved.snapshot) };
  }
  function render() {
    const snapshot = current.snapshot;
    transcript.render(snapshot.turns, interruptedNotice);
    select.replaceChildren();
    for (const row of decode(bridge.listConversations(mode))) {
      const option = document.createElement('option'); option.value = row.id; option.textContent = row.title; select.append(option);
    }
    select.value = snapshot.id;
    status.textContent = `${mode === 'demo' ? '离线演练' : 'DeepSeek'}对话 · ${snapshot.turns.length}/40 轮 · 保存在本机`;
    prompt.value = snapshot.draft;
  }
  function load(nextMode, id) {
    mode = nextMode;
    const rows = decode(bridge.listConversations(mode));
    const selected = id || rows[0]?.id;
    current = selected ? decode(bridge.readConversation(selected)) : null;
    if (selected && !current) throw new Error('对话不存在。');
    if (current) {
      const restored = recoverConversation(current.snapshot);
      if (restored.mode !== mode) throw new Error('对话模式不一致。');
      if (current.snapshot.turns.some(turn => turn.status === 'running')) save(restored);
      else current.snapshot = restored;
    } else save(newConversation(nonce(), mode));
    healthy = true; document.getElementById('ai-send').disabled = busy; clearTransient(); render();
  }
  create.addEventListener('click', () => {
    if (busy || !healthy) return;
    try {
      if (decode(bridge.listConversations(mode)).length >= 20) { status.textContent = '本试验每种模式最多 20 个对话；已有记录保留。'; return; }
      current = null; save(newConversation(nonce(), mode)); clearTransient(); render();
    } catch { fail(); }
  });
  select.addEventListener('change', () => { if (!busy) try { load(mode, select.value); } catch { fail(); } });
  prompt.addEventListener('input', () => {
    if (!busy && healthy) try { save({ ...current.snapshot, draft: prompt.value }); } catch { fail(); }
  });
  return {
    load(mode) { try { load(mode); } catch { fail(); } },
    begin(id, text) {
      if (!healthy || !current) throw new Error('会话存储不可用，请重新打开应用。');
      const history = conversationHistory(current.snapshot);
      save(beginConversationTurn(current.snapshot, id, text)); render(); return history;
    },
    record(message) { save(recordConversationMessage(current.snapshot, message)); },
    finish(reply, complete) { save(finishConversationTurn(current.snapshot, reply, complete)); render(); },
    busy(value) { busy = value; select.disabled = value || !healthy; create.disabled = value || !healthy; prompt.disabled = value; },
    get healthy() { return healthy; },
    fail,
  };
}
