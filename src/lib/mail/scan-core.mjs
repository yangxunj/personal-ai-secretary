import { normalizeMail } from './gws.mjs';

// 每日回顾固定结束时间，分批完成同一窗口；停机遗留窗口完成后补到本轮起点。
// 每批仍最多20封，成功后立即交给调用方保存，后续失败不重做已完成批次。
export async function scanReview({ state, onBatch, now = new Date(), ...options }) {
  if (!state) throw new Error('每日回顾缺少扫描台账，已停止');
  let current = state;
  do {
    current = await scanBatch({ ...options, state: current, now });
    await onBatch(current);
  } while (current.morePending || current.cursor < Math.floor(now.getTime() / 1000));
  return current;
}

// 固定本轮时间窗口和分页游标：批次未全部处理前，不能把扫描水位往前推。
export async function scanBatch({ state, reader, analyze, account, now = new Date(), limit = 20 }) {
  const next = structuredClone({ account, cursor: Math.floor(now.getTime() / 1000) - 7 * 86400, seen: [], findings: [], totalAnalyzed: 0, ...state });
  if (next.account !== account) throw new Error('扫描台账账号不一致');
  await reader.profile(account);
  const until = Math.floor(now.getTime() / 1000);
  next.window ??= { until, pageToken: null, pending: [], listed: false };
  const seen = new Set(next.seen);
  const selected = [];
  let pages = 0, resetExpiredPage = false;
  while (selected.length < limit) {
    while (next.window.pending.length && selected.length < limit) {
      const id = next.window.pending.shift();
      if (!seen.has(id) && !selected.includes(id)) selected.push(id);
    }
    if (selected.length === limit || (next.window.listed && !next.window.pageToken)) break;
    if (++pages > 10) break;
    let page;
    try { page = await reader.list({ q: `after:${next.cursor - 2} before:${next.window.until} -in:spam -in:trash -in:sent -in:drafts`, maxResults: 100, ...(next.window.pageToken ? { pageToken: next.window.pageToken } : {}) }); }
    catch (error) {
      // 停机过久的分页令牌可能失效：从原时间窗口重列，已有seen防止重复分析。
      if (Number(error.status) !== 400 || !next.window.pageToken || resetExpiredPage) throw error;
      resetExpiredPage = true; next.window.pageToken = null; next.window.listed = false;
      continue;
    }
    next.window.pending.push(...(page.messages ?? []).map(m => m.id));
    next.window.pageToken = page.nextPageToken ?? null;
    next.window.listed = true;
  }
  const messages = [], removed = [];
  for (const id of selected) {
    try { messages.push(normalizeMail(await reader.message(id), account)); }
    catch (error) { if (Number(error.status) === 404) removed.push(id); else throw error; }
  }
  const decisions = messages.length ? await analyze(messages) : [];
  const byId = new Map(messages.map(m => [m.id, m]));
  if (decisions.length !== messages.length || new Set(decisions.map(d => d.id)).size !== messages.length || decisions.some(d => !byId.has(d.id))) throw new Error('筛选批次不完整，不能推进水位');
  for (const item of decisions) {
    const message = byId.get(item.id);
    if (item.importance !== 'ignore') {
      next.findings = next.findings.filter(f => f.id !== item.id);
      const { body, snippet, ...source } = message;
      next.findings.push({ ...source, ...item, detectedAt: now.toISOString(), confirmed: false });
    }
    seen.add(item.id);
  }
  for (const id of removed) seen.add(id);
  next.seen = [...seen];
  next.totalAnalyzed += messages.length;
  next.lastBatchCount = messages.length;
  next.lastCheckedAt = now.toISOString();
  next.lastSuccessAt = now.toISOString();
  next.lastError = null;
  next.morePending = next.window.pending.length > 0 || Boolean(next.window.pageToken) || !next.window.listed;
  if (!next.morePending) { next.cursor = next.window.until; next.window = null; }
  return next;
}
