import { newConversation, parseConversation, recoverConversation, conversationHistory, beginConversationTurn,
  recordConversationMessage, finishConversationTurn, interruptedNotice } from '../../../src/lib/pi/conversation.mjs';
import { publicWebUrl } from '../../../src/lib/web-search/url.mjs';

export function attachConversationPanel(document, bridge, nonce, messageUi, onSend, closeDrawer) {
  const status = document.getElementById('conversation-status');
  if (!messageUi?.createConversationControls) throw new Error('共用会话界面未加载，请重新打开应用。');
  const transcript = messageUi.createTranscript(document.getElementById('conversation-messages'), url => {
    try { bridge.openWebLink(publicWebUrl(url)); }
    catch { document.getElementById('message-link-status').textContent = '无法打开此链接。'; }
  });
  let current, mode = 'demo', busy = false, healthy = true, draft = '', items = [], pendingDelete;
  const deleteDialog = document.getElementById('conversation-delete-dialog');
  const deleteError = document.getElementById('conversation-delete-error');
  const decode = raw => { const result = JSON.parse(raw); if (!result.ok) throw new Error('会话保存或读取失败，请重新打开应用后检查。'); return result.data; };
  const controls = messageUi.createConversationControls(document.getElementById('shared-conversation-list'), document.getElementById('shared-composer'), {
    onSelect(id) { if (busy || !healthy) return false; try { load(mode, id); return true; } catch { fail(); return false; } },
    onNew() {
      if (busy || !healthy) return false;
      try {
        if (decode(bridge.listConversations(mode)).length >= 20) { status.textContent = '本试验每种模式最多 20 个对话；已有记录保留。'; return false; }
        current = null; save(newConversation(nonce(), mode)); clearTransient(); render();
        return true;
      } catch { fail(); return false; }
    },
    onDelete(id) {
      if (busy || !healthy) return;
      pendingDelete = null;
      const confirm = document.getElementById('conversation-delete-confirm');
      try {
        const row = decode(bridge.readConversation(id));
        if (!row || row.snapshot.mode !== mode) throw new Error('missing');
        pendingDelete = { id, mode, version: row.version };
        document.getElementById('conversation-delete-name').textContent = row.snapshot.title;
        confirm.disabled = false; deleteError.textContent = '';
      } catch {
        document.getElementById('conversation-delete-name').textContent = '';
        confirm.disabled = true; deleteError.textContent = '无法读取对话，请关闭后重试。';
      }
      deleteDialog.showModal();
    },
    onDraftChange(value) {
      draft = value;
      if (!busy && healthy) try { save({ ...current.snapshot, draft }); } catch { fail(); }
      renderControls();
    },
    onSend() { if (!busy && healthy && mode === 'deepseek' && draft.trim()) onSend(); },
  }, closeDrawer);
  document.getElementById('conversation-delete-cancel').addEventListener('click', () => deleteDialog.close());
  deleteDialog.addEventListener('close', () => { pendingDelete = null; });
  document.getElementById('conversation-delete-confirm').addEventListener('click', () => {
    if (!pendingDelete || busy || !healthy) return;
    const target = pendingDelete;
    try { decode(bridge.deleteConversation(target.id, target.mode, target.version)); }
    catch { deleteError.textContent = '删除失败，对话可能已发生变化。请取消后重新打开列表再试。'; return; }
    deleteDialog.close(); pendingDelete = null;
    try {
      if (current.snapshot.id === target.id) { current = null; load(mode); }
      else render();
    } catch { fail(); status.textContent = '对话已删除，但列表读取失败，请重新打开应用。'; }
  });
  function renderControls() {
      document.getElementById('ai-send').disabled = busy || !healthy || (mode === 'deepseek' && !draft.trim());
    controls.render({ items, activeId: current?.snapshot.id ?? null, disabled: busy || !healthy, busy, draft,
      canSend: healthy && !busy && mode === 'deepseek' && !!draft.trim() });
  }
  function fail() { healthy = false; status.textContent = '会话存储不可用，已停止发送。草稿保留，请重新打开应用后检查。'; document.querySelector('.ai-panel').scrollTop = 0; document.getElementById('ai-send').disabled = true; renderControls(); }
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
    status.textContent = '';
    draft = snapshot.draft; renderControls();
    // When a conversation is opened or a turn changes, show the newest reply.
    // Typing a draft does not invoke render(), so it will not move the reader.
    document.defaultView.requestAnimationFrame(() => {
      const panel = document.querySelector('.ai-panel');
      if (panel && !panel.hidden) panel.scrollTop = panel.scrollHeight;
    });
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
