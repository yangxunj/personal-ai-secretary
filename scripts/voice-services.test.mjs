import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/voice-services.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { webVoiceServices } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const services = webVoiceServices(message => message);

test('web adapter sends WAV to ASR and does not submit unrecognized speech', async () => {
  const audio = new Uint8Array([1, 2]).buffer;
  const signal = new AbortController().signal;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/asr'); assert.equal(options.body, audio);
    assert.equal(options.headers['Content-Type'], 'audio/wav');
    return Response.json({ text: '  你好  ' });
  };
  assert.equal(await services.transcribe(audio, signal), '你好');
  globalThis.fetch = async () => Response.json({ error: 'empty' }, { status: 422 });
  assert.equal(await services.transcribe(audio, signal), null);
  globalThis.fetch = async () => Response.json({ text: '   ' });
  assert.equal(await services.transcribe(audio, signal), null);
});

test('web adapter rejects invalid ASR responses and forwards safe route errors', async () => {
  globalThis.fetch = async () => Response.json({ error: '配置有误' }, { status: 503 });
  await assert.rejects(services.transcribe(new ArrayBuffer(2), new AbortController().signal), /配置有误/);
  globalThis.fetch = async () => Response.json({ text: 123 });
  await assert.rejects(services.transcribe(new ArrayBuffer(2), new AbortController().signal), /语音识别失败/);
});

test('web adapter sends each TTS segment and rejects non-audio and empty responses', async () => {
  const signal = new AbortController().signal;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/tts'); assert.deepEqual(JSON.parse(options.body), { text: '你好' });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/wav' } });
  };
  assert.equal((await services.synthesize('你好', signal)).byteLength, 3);
  globalThis.fetch = async () => Response.json({ error: '配额不足' }, { status: 429 });
  await assert.rejects(services.synthesize('你好', signal), /配额不足/);
  globalThis.fetch = async () => new Response(null, { headers: { 'Content-Type': 'audio/wav' } });
  await assert.rejects(services.synthesize('你好', signal), /语音合成失败/);
});

test('web adapter passes cancellation to the in-flight request', async () => {
  const controller = new AbortController();
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const result = services.transcribe(new ArrayBuffer(2), controller.signal);
  controller.abort();
  await assert.rejects(result, error => error.name === 'AbortError');
});
