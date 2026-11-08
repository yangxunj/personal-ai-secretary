import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { recommendationBatches, recommendWeekend } from '../src/lib/weekend/recommend.mjs';

const sample = (count, padding = '') => ({ saturday: '2026-11-07', sunday: '2026-11-08', reports: [{ source: 'hktb', ok: false }], rows: Array.from({ length: count }, (_, i) => ({ title: `活动 ${i}${padding}`, source: 'hkpl', start: '2026-11-07', end: '2026-11-08', family: true, description: '简短介绍', spots: [{ start: '2026-11-07', time: '10:00', venue: '图书馆' }] })) });
const fakeModel = async request => {
  const input = JSON.parse(request.messages[1].content);
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '有适合家庭的活动。', recommendations: input.activities.slice(0, input.count).map(row => ({ id: row.id, reason: '亲子活动，可查看官网详情。' })) }) } }] };
};

test('Android bundle records the current shared recommendation source', () => {
  const manifest = JSON.parse(readFileSync(new URL('../experiments/android-shared/web-dist/build-manifest.json', import.meta.url), 'utf8'));
  const expected = createHash('sha256').update(readFileSync(new URL('../src/lib/weekend/recommend.mjs', import.meta.url))).digest('hex');
  assert.equal(manifest.weekendRecommendSha256, expected);
});

test('recommends five real IDs and includes optional preference without guessing details', async () => {
  let request;
  const result = await recommendWeekend(sample(8), async body => { request = body; return fakeModel(body); }, () => {}, '靠近地铁');
  assert.equal(result.assessed, 8); assert.equal(result.requests, 1); assert.deepEqual(result.recommendations.map(r => r.id), ['0', '1', '2', '3', '4']);
  assert.equal(result.summary, '有适合家庭的活动。');
  const input = JSON.parse(request.messages[1].content);
  assert.equal(input.preference, '靠近地铁'); assert.deepEqual(input.unavailableSources, ['hktb']);
  assert.equal(input.activities.length, 8); assert.match(request.messages[0].content, /不得假设/);
});

test('covers all activity batches and performs a final selection', async () => {
  const data = sample(220, '較長活動標題'.repeat(8));
  const batches = recommendationBatches(data); assert.ok(batches.length > 1);
  const seen = new Set(); let calls = 0;
  const result = await recommendWeekend(data, async body => {
    calls++;
    assert.ok(JSON.stringify(body).length < 60000);
    const input = JSON.parse(body.messages[1].content);
    if (calls <= batches.length) for (const item of input.activities) seen.add(item.id);
    return fakeModel(body);
  });
  assert.equal(seen.size, data.rows.length); assert.equal(result.assessed, data.rows.length);
  assert.ok(result.requests > batches.length); assert.equal(result.recommendations.length, 5);
});

test('rejects invented, repeated, truncated and malformed recommendations', async () => {
  const answer = recommendations => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '活动概述', recommendations }) } }] });
  const valid = Array.from({ length: 5 }, (_, id) => ({ id: String(id), reason: '适合家庭' }));
  await assert.rejects(() => recommendWeekend(sample(5), async () => answer([{ id: '99', reason: '不存在' }, ...valid.slice(1)])), /核对/);
  await assert.rejects(() => recommendWeekend(sample(5), async () => answer([valid[0], ...valid.slice(0, 4)])), /核对/);
  await assert.rejects(() => recommendWeekend(sample(5), async () => ({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })), /不完整/);
  await assert.rejects(() => recommendWeekend(sample(5), async () => answer(valid.slice(0, 2))), /数量/);
  await assert.rejects(() => recommendWeekend(sample(0), fakeModel), /没有可推荐/);
});
