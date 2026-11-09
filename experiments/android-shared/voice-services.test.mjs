import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createVoiceServices } from './web/voice-services.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function setup() {
  const calls = [], host = { crypto: webcrypto, btoa, atob };
  const bridge = {
    beginVoiceRequest(id, kind, payload) { calls.push({ id, kind, payload }); },
    cancelVoiceRequest(id) { calls.push({ cancel: id }); },
  };
  const services = createVoiceServices(host, bridge);
  return { host, calls, services };
}
test('native voice adapter preserves audio bytes and handles empty recognition', async () => {
  const { host, calls, services } = setup(), signal = new AbortController().signal;
  const bytes = Uint8Array.from({ length: 70000 }, (_, i) => i % 256);
  const recognition = services.transcribe(bytes.buffer, signal);
  assert.equal(calls[0].kind, 'asr'); assert.deepEqual(Buffer.from(calls[0].payload, 'base64'), Buffer.from(bytes));
  host.SecretaryVoice.receive(calls[0].id, JSON.stringify({ ok: true, data: '  测试  ' }));
  assert.equal(await recognition, '测试');
  const empty = services.transcribe(bytes.buffer, signal);
  host.SecretaryVoice.receive(calls[1].id, JSON.stringify({ ok: true, data: '  ' }));
  assert.equal(await empty, null);
  const playback = services.synthesize('你好', signal);
  assert.equal(calls[2].kind, 'tts'); assert.equal(calls[2].payload, '你好');
  host.SecretaryVoice.receive(calls[2].id, JSON.stringify({ ok: true, data: Buffer.from(bytes).toString('base64') }));
  assert.deepEqual(Buffer.from(await playback), Buffer.from(bytes));
});
test('abort cancels only the matching request and ignores late native results', async () => {
  const { host, calls, services } = setup(), controller = new AbortController();
  const first = services.synthesize('第一句', controller.signal), id = calls[0].id;
  controller.abort(); await assert.rejects(first, { name: 'AbortError' });
  assert.deepEqual(calls[1], { cancel: id });
  const second = services.synthesize('第二句', new AbortController().signal);
  host.SecretaryVoice.receive(id, JSON.stringify({ ok: true, data: 'AQ==' }));
  host.SecretaryVoice.receive(calls[2].id, JSON.stringify({ ok: true, data: 'Ag==' }));
  assert.deepEqual([...new Uint8Array(await second)], [2]);
});
test('native failures propagate without leaving a pending request', async () => {
  const { host, calls, services } = setup();
  const result = services.synthesize('文字', new AbortController().signal);
  host.SecretaryVoice.receive(calls[0].id, JSON.stringify({ ok: false, error: '配置无效' }));
  await assert.rejects(result, /配置无效/);
});
test('Android bundle includes the unchanged shared voice component and worklet', () => {
  const manifest = JSON.parse(readFileSync(new URL('./web-dist/build-manifest.json', import.meta.url)));
  assert.ok(manifest.sharedUiSources.some(item => item.file === 'src/components/chat/VoiceConversation.tsx'));
  const sha = input => createHash('sha256').update(input).digest('hex');
  const source = readFileSync(new URL('../../public/worklets/voice-capture.js', import.meta.url));
  const asset = readFileSync(new URL('./web-dist/voice-capture.js', import.meta.url));
  assert.equal(sha(source), manifest.voiceWorkletSha256); assert.equal(sha(source), sha(asset));
});
