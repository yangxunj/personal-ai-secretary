import test from 'node:test';
import assert from 'node:assert/strict';
import { weekendFor, parseHktb, parseHkpl, parseLcsdm, projectWeekend, groupWeekend } from '../src/lib/weekend/engine.mjs';
import { loadWeekend } from '../src/lib/weekend/service.mjs';

test('Hong Kong local Sunday stays in current weekend and cross-month dates remain correct', () => {
  assert.deepEqual(weekendFor(new Date('2026-08-30T00:30:00+08:00')), ['2026-08-29', '2026-08-30']);
  assert.deepEqual(weekendFor(new Date('2026-10-30T12:00:00+08:00')), ['2026-10-31', '2026-11-01']);
});

test('a failed source is reported while valid results survive; total failure is explicit', async () => {
  const row = Array(23).fill(''); Object.assign(row, { 0: '2026/10/31', 1: '2026/11/01', 13: '合成展覽' });
  const result = await loadWeekend({ async get({ source }) { if (source === 'lcsdm') return row.join('\t'); throw new Error('offline'); } }, new Date('2026-10-30T04:00:00Z'));
  assert.equal(result.rows.length, 1); assert.deepEqual(result.reports.map(report => report.ok), [false, false, true]);
  await assert.rejects(() => loadWeekend({ async get() { throw new Error('offline'); } }), /三个来源/);
});

test('cross-month weekends fetch both monthly library listings', async () => {
  const calls = [];
  const result = await loadWeekend({ async get(query) {
    if (query.source !== 'hkpl') throw new Error('offline');
    calls.push(`${query.year}-${query.month}`);
    return '<div class="event_in_series"><a href="/tc/extension-activities/event-detail/1"><span class="word_c">親子活動</span></a><td class="date_de detail">2026年11月1日</td>';
  } }, new Date('2026-10-30T04:00:00Z'));
  assert.deepEqual(calls.sort(), ['2026-10', '2026-11']);
  assert.equal(result.rows.length, 1);
});

test('official source adapters retain dates and links and do not invent prices', () => {
  const event = { startDate: '2026-10-31', endDate: '2026-11-01', title: '展覽', addr: '香港', eventCategories: ['親子'], pageUrl: 'https://example.org/event' };
  const [hktb] = parseHktb('prefix ' + JSON.stringify([event]) + ' suffix');
  assert.equal(hktb.family, true); assert.equal(hktb.start, '2026-10-31'); assert.equal(hktb.url, event.pageUrl); assert.equal(hktb.price, undefined);
  const html = '<div class="event_in_series"><a href="/tc/extension-activities/event-detail/123"><span class="word_c">兒童故事時間</span></a><td class="date_de detail">2026年11月1日</td><td class="time_de detail">10:30</td><td class="venue_de detail">圖書館</td>';
  const [library] = parseHkpl(html);
  assert.equal(library.start, '2026-11-01'); assert.equal(library.time, '10:30'); assert.equal(library.family, true);
  const fields = Array(23).fill(''); Object.assign(fields, { 0: '2026/10/31', 1: '2026/11/01', 4: 'Science', 6: 'ScM', 13: '科學展', 15: '科學館', 17: 'https://example.org/exhibit' });
  const [museum] = parseLcsdm(fields.join('\t'));
  assert.equal(museum.end, '2026-11-01'); assert.equal(museum.family, true); assert.equal(museum.price, undefined);
  fields[9] = 'English description\ncontinued on a second line'; fields[14] = '第一段\n第二段';
  const multiline = parseLcsdm('header\n' + fields.join('\t') + '\n' + fields.join('\t'));
  assert.equal(multiline.length, 2); assert.equal(multiline[0].title, '科學展'); assert.equal(multiline[0].description, '第一段 第二段');
});

test('deduplicates, groups repeated performances, excludes shelves and preserves outside range', () => {
  const row = { source: 'hkpl', title: '故事時間', start: '2026-10-31', end: '2026-10-31', time: '10:30', venue: '甲館', url: null, score: 5, family: true };
  const data = projectWeekend([row, { ...row }, { ...row, venue: '乙館', start: '2026-11-01', end: '2026-11-01' }, { ...row, title: '書籍介紹', display: true }, { ...row, title: '舊活動', start: '2026-10-01', end: '2026-10-02' }], '2026-10-31', '2026-11-01');
  assert.equal(data.rows.length, 1); assert.equal(data.rows[0].spots.length, 2); assert.equal(data.excludedShelves, 1);
  const grouped = groupWeekend(data.rows, data.saturday, data.sunday);
  assert.equal(grouped.groups[0].rows.length, 1);
});
