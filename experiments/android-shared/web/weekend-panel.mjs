import { loadWeekend } from '../../../src/lib/weekend/service.mjs';
import { SOURCES, weekendFor, groupWeekend } from '../../../src/lib/weekend/engine.mjs';
import { recommendWeekend } from '../../../src/lib/weekend/recommend.mjs';

/** Android bridge handles only transport/storage; source parsing is shared. */
export function attachWeekendPanel(document, host) {
  const bridge = host.SecretaryStorage, status = document.getElementById('weekend-status');
  const container = document.getElementById('weekend-results'), button = document.getElementById('weekend-refresh');
  const recommend = document.getElementById('weekend-recommend'), aiStatus = document.getElementById('weekend-ai-status');
  const recommendations = document.getElementById('weekend-recommendations'), preference = document.getElementById('weekend-preference');
  let currentData = null, busy = false;
  const pending = new Map(); let serial = 0;
  const session = Array.from(host.crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('');
  host.SecretaryWeekend = { receive(id, raw) {
    const entry = pending.get(id); if (!entry) return;
    pending.delete(id); host.clearTimeout(entry.timer);
    try { const result = JSON.parse(raw); if (!result.ok || typeof result.data !== 'string') throw new Error(); entry.resolve(result.data); }
    catch { entry.reject(new Error('来源暂时不可用')); }
  } };
  const adapter = { get(query) { return new Promise((resolve, reject) => {
    if (!bridge?.fetchWeekendSource) { reject(new Error('网络功能不可用')); return; }
    const id = `weekend-${session}-${++serial}`;
    const timer = host.setTimeout(() => { pending.delete(id); reject(new Error('请求超时')); }, 55000);
    pending.set(id, { resolve, reject, timer });
    try { bridge.fetchWeekendSource(id, JSON.stringify(query)); }
    catch { pending.delete(id); host.clearTimeout(timer); reject(new Error('网络功能不可用')); }
  }); } };
  function el(tag, text, className) { const element = document.createElement(tag); if (text != null) element.textContent = text; if (className) element.className = className; return element; }
  const sources = document.getElementById('weekend-source-links');
  for (const source of Object.values(SOURCES)) {
    const link = el('button', `${source.label}官网 ↗`, 'weekend-link'); link.type = 'button';
    link.addEventListener('click', () => bridge.openWeekendLink?.(source.url)); sources.append(link, document.createTextNode('　'));
  }
  function render(data) {
    if (!data || !Array.isArray(data.rows) || !Array.isArray(data.reports) || !/^\d{4}-\d{2}-\d{2}$/.test(data.saturday) || !/^\d{4}-\d{2}-\d{2}$/.test(data.sunday) || data.rows.length > 10000) throw new Error('缓存格式有误');
    container.replaceChildren();
    const current = weekendFor();
    currentData = data;
    recommend.disabled = busy || !data.rows.length || data.saturday !== current[0];
    recommendations.replaceChildren();
    container.append(el('p', `活动范围：${data.saturday} 至 ${data.sunday} · 更新于 ${new Date(data.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Hong_Kong' })}（香港时间）`));
    if (data.saturday !== current[0]) container.append(el('p', '这份结果不是当前周末的数据，请点击更新。'));
    const failed = data.reports.filter(item => !item.ok).map(item => SOURCES[item.source]?.label || '未知来源');
    if (failed.length) container.append(el('p', `以下来源未能读取，本次结果不完整：${failed.join('、')}。`));
    const grouped = groupWeekend(data.rows, data.saturday, data.sunday);
    container.append(el('p', `共 ${data.rows.length} 项；已排除主题书架 ${data.excludedShelves || 0} 条${grouped.omitted ? `，其他活动省略 ${grouped.omitted} 项` : ''}。票价、预约及临时变更请查看官方链接。`));
    if (!data.rows.length) container.append(el('p', '已读取的来源没有筛出这个周末的活动。'));
    const saved = data.aiRecommendations;
    if (saved && Array.isArray(saved.recommendations) && saved.recommendations.length > 0 && saved.recommendations.length <= 5) {
      const unique = new Set();
      const valid = saved.recommendations.every(item => typeof item?.id === 'string' && /^(0|[1-9]\d*)$/.test(item.id) && Number(item.id) < data.rows.length && !unique.has(item.id) && (unique.add(item.id), true) && typeof item.reason === 'string' && item.reason.length > 0 && item.reason.length <= 200);
      if (valid) {
        recommendations.append(el('h3', 'AI 推荐'));
        recommendations.append(el('p', `AI 综合评估 ${saved.assessed} 项活动摘要；推荐理由仅供参考，详情请核对官网。`));
        if (typeof saved.summary === 'string' && saved.summary.length <= 240) recommendations.append(el('p', `活动概述：${saved.summary}`));
        if (data.reports.some(item => !item.ok)) recommendations.append(el('p', '部分来源未能读取，推荐仅基于成功获取的活动。'));
        for (const [index, item] of saved.recommendations.entries()) {
          const row = data.rows[Number(item.id)], card = el('article', null, 'weekend-event');
          card.append(el('strong', `${index + 1}. ${row.title}`));
          card.append(el('p', `推荐理由：${item.reason}`));
          card.append(el('p', `${SOURCES[row.source]?.label || '来源未知'} · ${row.start} 至 ${row.end}`));
          const spots = Array.isArray(row.spots) ? row.spots : [];
          for (const spot of spots.slice(0, 3)) {
            const label = [spot.start, spot.time, spot.venue || '地点未注明'].filter(Boolean).join(' · ');
            if (spot.url) { const link = el('button', label + ' ↗', 'weekend-link'); link.type = 'button'; link.addEventListener('click', () => bridge.openWeekendLink?.(spot.url)); card.append(link); }
            else card.append(el('p', label));
          }
          if (spots.length > 3) card.append(el('p', `另有 ${spots.length - 3} 场，可在全部活动中查看。`));
          recommendations.append(card);
        }
      }
    }
    const all = el('details'); all.append(el('summary', `查看全部活动（${data.rows.length} 项）`));
    for (const section of grouped.groups) {
      if (!section.rows.length) continue;
      all.append(el('h3', section.title));
      for (const row of section.rows) {
      if (!row || !Array.isArray(row.spots)) continue;
      const details = el('details', null, 'weekend-event');
      details.append(el('summary', row.title || '未命名活动'));
      details.append(el('p', `${SOURCES[row.source]?.label || '来源未知'} · ${row.start} 至 ${row.end}${row.family ? ' · 亲子线索' : ''}`));
      if (row.description) details.append(el('p', row.description.slice(0, 400)));
      for (const spot of row.spots) {
        const block = el('div'), label = [spot.start, spot.time, spot.venue || '地点未注明'].filter(Boolean).join(' · ');
        if (spot.url) { const link = el('button', label + ' ↗', 'weekend-link'); link.type = 'button'; link.addEventListener('click', () => bridge.openWeekendLink?.(spot.url)); block.append(link); }
        else block.append(el('p', label));
        details.append(block);
      }
      all.append(details);
      }
    }
    if (data.rows.length) container.append(all);
  }
  let cached = '';
  try { cached = bridge?.readWeekendCache?.() || ''; if (cached) render(JSON.parse(cached)); }
  catch { status.textContent = '本机缓存无法读取，请重新更新。'; }
  if (!cached) status.textContent = '点击更新，获取最近一个周末的活动。';
  button.addEventListener('click', async () => {
    busy = true; button.disabled = true; recommend.disabled = true; status.textContent = '正在读取官方来源，图书馆活动可能需要较长时间……';
    let updated = false;
    try {
      const result = await loadWeekend(adapter);
      const saved = bridge.saveWeekendCache?.(JSON.stringify(result)) === true;
      render(result);
      updated = true;
      aiStatus.textContent = '';
      status.textContent = saved ? '更新完成，结果已保存在本机。' : '更新完成，但未能保存到本机；关闭后需重新更新。';
    } catch (error) { status.textContent = `${error.message || '更新失败'} ${container.childElementCount ? '已保留之前的结果。' : '目前没有可显示的结果。'}`; }
    finally { busy = false; button.disabled = false; if (currentData) recommend.disabled = !currentData.rows.length || currentData.saturday !== weekendFor()[0]; }
    if (updated && !recommend.disabled) recommend.click();
  });
  recommend.addEventListener('click', async () => {
    if (!currentData || busy) return;
    if (currentData.saturday !== weekendFor()[0]) { aiStatus.textContent = '活动数据已过期，请先更新。'; return; }
    if (!bridge.hasApiKey?.()) { aiStatus.textContent = '请先在设置中配置 DeepSeek 密钥。'; return; }
    if (!host.SecretaryAI?.request) { aiStatus.textContent = '模型连接不可用，请重新打开应用。'; return; }
    busy = true; button.disabled = true; recommend.disabled = true;
    const snapshot = currentData, controller = new AbortController();
    try {
      const result = await recommendWeekend(snapshot, request => host.SecretaryAI.request(request, controller.signal),
        count => { aiStatus.textContent = `AI 正在比较活动（第 ${count} 次模型请求）……`; }, preference.value.trim());
      snapshot.aiRecommendations = result;
      const saved = bridge.saveWeekendCache?.(JSON.stringify(snapshot)) === true;
      render(snapshot);
      aiStatus.textContent = saved ? '推荐已生成并保存在本机。' : '推荐已生成，但未能保存到本机。';
      if (!document.querySelector('.pilot-weekend').hidden) recommendations.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { aiStatus.textContent = error.message || 'AI 推荐未能完成，请重试。'; }
    finally { busy = false; button.disabled = false; recommend.disabled = !currentData?.rows.length || currentData.saturday !== weekendFor()[0]; }
  });
}
