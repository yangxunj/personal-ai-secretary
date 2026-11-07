import { newConversation, parseConversation, recoverConversation, conversationHistory, beginConversationTurn,
  recordConversationMessage, finishConversationTurn, interruptedNotice } from '../../../src/lib/pi/conversation.mjs';

export function attachConversationPanel(document, bridge, nonce, messageUi, onSend) {
  const status = document.getElementById('conversation-status');
  if (!messageUi?.createConversationControls) throw new Error('共用会话界面未加载，请重新打开应用。');
  const transcript = messageUi.createTranscript(document.getElementById('conversation-messages'), () => { document.getElementById('message-link-status').textContent = '此试验版暂不打开外部链接。'; });
  let current, mode = 'demo', busy = false, healthy = true, draft = '', items = [];
  const decode = raw => { const result = JSON.parse(raw); if (!result.ok) throw new Error('会话保存或读取失败，请重新打开应用后检查。'); return result.data; };
  const controls = messageUi.createConversationControls(document.getElementById('shared-conversation-list'), document.getElementById('shared-composer'), {
    onSelect(id) { if (!busy && healthy) try { load(mode, id); } catch { fail(); } },
    onNew() {
      if (busy || !healthy) return;
      try {
        if (decode(bridge.listConversations(mode)).length >= 20) { status.textContent = '本试验每种模式最多 20 个对话；已有记录保留。'; return; }
        current = null; save(newConversation(nonce(), mode)); clearTransient(); render();
      } catch { fail(); }
    },
    onDraftChange(value) {
      draft = value;
      if (!busy && healthy) try { save({ ...current.snapshot, draft }); } catch { fail(); }
      renderControls();
    },
    onSend() { if (!busy && healthy && mode === 'deepseek' && draft.trim()) onSend(); },
  });
  function renderControls() {
      document.getElementById('ai-send').disabled = busy || !healthy || (mode === 'deepseek' && !draft.trim());
    controls.render({ items, activeId: current?.snapshot.id ?? null, disabled: busy || !healthy, busy, draft,
      canSend: healthy && !busy && mode === 'deepseek' && !!draft.trim() });
  }
  function fail() { healthy = false; status.textContent = '会话存储不可用，已停止发送。草稿保留，请重新打开应用后检查。'; document.getElementById('ai-send').disabled = true; renderControls(); }
  const clearTransient = () => { document.getElementById('ai-output').textContent = ''; document.getElementById('ai-events').replaceChildren(); document.getElementById('message-link-status').textContent = ''; };
  function save(snapshot) {
    const next = parseConversation(snapshot);
    const saved = decode(bridge.saveConversation(next.id, current?.version || 0, JSON.stringify(next)));
    current = { version: saved.version, snapshot: parseConversation(saved.snapshot) };
  }
  function render() {
    const snapshot = current.snapshot;
    transcript.render(snapshot.turns, interruptedNotice);
    items = decode(bridge.listConversations(mode)).map(row => ({ ...row, updatedAt: new Date(row.updatedAt ?? 0).toISOString() }));
    status.textContent = `${mode === 'demo' ? '离线演练' : 'DeepSeek'}对话 · ${snapshot.turns.length}/40 轮 · 保存在本机`;
    draft = snapshot.draft; renderControls();
  }
  function load(nextMode, id) {
    mode = nextMode;
    const rows = decode(bridge.listConversations(mode)), selected = id || rows[0]?.id;
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
  return {
    load(mode) { try { load(mode); } catch { fail(); } },
    begin(id, text) {
      if (!healthy || !current) throw new Error('会话存储不可用，请重新打开应用。');
      const history = conversationHistory(current.snapshot);
      save(beginConversationTurn(current.snapshot, id, text)); render(); return history;
    },
    record(message) { save(recordConversationMessage(current.snapshot, message)); },
    finish(reply, complete) { save(finishConversationTurn(current.snapshot, reply, complete)); render(); },
    busy(value) { busy = value; renderControls(); },
    get draft() { return draft; }, get healthy() { return healthy; }, fail,
  };
}
