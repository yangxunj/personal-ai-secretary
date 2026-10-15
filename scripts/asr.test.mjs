import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// 独立测试纯模块，不加载 Next、生产数据库或真实密钥。
const moduleUrl = (path, replacements = {}) => {
  let source = readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const [name, replacement] of Object.entries(replacements)) source = source.replaceAll(name, replacement);
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText).toString('base64');
};
const audioUrl = moduleUrl('../src/lib/voice-audio.ts');
const asrUrl = moduleUrl('../src/lib/asr.ts');
const { encodeVoiceWav, validVoiceWav, VOICE_MAX_BYTES } = await import(audioUrl);
const { getAsrConfig, transcribeVoice } = await import(asrUrl);
const audio = encodeVoiceWav(new Float32Array(16000).fill(0.1));
const cfg = { apiKey: 'synthetic-test-key', baseUrl: 'https://asr.example/v1', model: 'qwen3-asr-flash' };

test('WAV header, sample clipping and duration boundaries', () => {
  const view = new DataView(encodeVoiceWav(new Float32Array([-2, -1, 0, 1, 2])));
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + i * 2, true)), [-32768, -32768, 0, 32767, 32767]);
  assert.ok(validVoiceWav(audio));
  assert.ok(!validVoiceWav(encodeVoiceWav(new Float32Array(3999))));
  const max = encodeVoiceWav(new Float32Array(16000 * 61));
  assert.equal(max.byteLength, VOICE_MAX_BYTES);
  assert.ok(validVoiceWav(max));
  const invalid = audio.slice(0); new DataView(invalid).setUint16(22, 2, true);
  assert.ok(!validVoiceWav(invalid));
  assert.ok(!validVoiceWav(audio.slice(0, -1)));
  assert.ok(!validVoiceWav(new ArrayBuffer(VOICE_MAX_BYTES + 1)));
});

test('ASR defaults never inherit chat credentials', () => {
  assert.equal(getAsrConfig({ AI_API_KEY: 'chat-key' }).apiKey, '');
  assert.equal(getAsrConfig({}).model, 'qwen3-asr-flash');
  assert.equal(getAsrConfig({ ASR_BASE_URL: 'https://asr.example/v1///' }).baseUrl, 'https://asr.example/v1');
});

test('ASR request, upstream failures and cancellation', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, cfg.baseUrl + '/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-test-key');
      const body = JSON.parse(options.body);
      assert.equal(body.model, cfg.model); assert.equal(body.stream, false);
      assert.equal(body.messages[0].content[0].type, 'input_audio');
      assert.deepEqual(Buffer.from(body.messages[0].content[0].input_audio.data.split(',')[1], 'base64'), Buffer.from(audio));
      return Response.json({ choices: [{ message: { content: '  明天下午三点开会。  ' } }] });
    };
    assert.equal(await transcribeVoice(audio, cfg), '明天下午三点开会。');
    for (const [status, code] of [[401, 'credentials'], [403, 'credentials'], [402, 'quota'], [429, 'busy'], [500, 'upstream']]) {
      globalThis.fetch = async () => new Response('sensitive-upstream-detail', { status });
      await assert.rejects(transcribeVoice(audio, cfg), (e) => e.code === code && !e.message.includes('sensitive'));
    }
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: ' ' } }] });
    await assert.rejects(transcribeVoice(audio, cfg), (e) => e.code === 'empty');
    globalThis.fetch = async () => { throw new DOMException('timeout', 'TimeoutError'); };
    await assert.rejects(transcribeVoice(audio, cfg), (e) => e.code === 'timeout');
    const controller = new AbortController(); controller.abort();
    globalThis.fetch = async (_url, options) => { options.signal.throwIfAborted(); };
    await assert.rejects(transcribeVoice(audio, cfg, controller.signal), (e) => e.name === 'AbortError');
  } finally { globalThis.fetch = original; }
});

test('ASR route rejects unauthenticated, foreign-origin and invalid audio without forwarding', async () => {
  const state = globalThis.__asrTest = { authorized: true, config: cfg, calls: 0, transcribe: async () => '测试文字' };
  const stub = 'data:text/javascript;base64,' + Buffer.from(`
    export const sessionIsCurrent = async () => globalThis.__asrTest.authorized;
    export const getT = async () => text => text;
    export const loadAsrConfig = async () => globalThis.__asrTest.config;
    export class AsrError extends Error {}
    export const transcribeVoice = async (...args) => { globalThis.__asrTest.calls++; return globalThis.__asrTest.transcribe(...args); };
  `).toString('base64');
  const route = await import(moduleUrl('../src/app/api/asr/route.ts', {
    '@/lib/auth': stub, '@/lib/i18n/server': stub, '@/lib/asr-config': stub,
    '@/lib/asr': stub, '@/lib/voice-audio': audioUrl,
  }));
  const request = (body = audio, headers = {}) => new Request('http://localhost:3097/api/asr', {
    method: 'POST', headers: { 'Content-Type': 'audio/wav', Origin: 'http://localhost:3097', ...headers }, body,
  });
  state.authorized = false;
  assert.equal((await route.POST(request())).status, 401);
  state.authorized = true;
  assert.equal((await route.POST(request(audio, { Origin: 'https://foreign.example' }))).status, 403);
  assert.equal((await route.POST(request(audio, { Origin: 'invalid' }))).status, 403);
  assert.equal((await route.POST(request(audio, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await route.POST(request(new Uint8Array(VOICE_MAX_BYTES + 1)))).status, 413);
  assert.equal((await route.POST(request(new Uint8Array(100)))).status, 400);
  state.config = { ...cfg, apiKey: '' };
  assert.equal((await route.POST(request())).status, 503);
  assert.equal(state.calls, 0);
  state.config = cfg;
  const response = await route.POST(request());
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: '测试文字' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  let release;
  state.transcribe = () => new Promise((resolve) => { release = resolve; });
  const first = route.POST(request());
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal((await route.POST(request())).status, 429);
  release('完成'); await first;
  state.transcribe = async () => { throw new Error('sensitive-detail'); };
  const failure = await route.POST(request());
  assert.equal(failure.status, 502); assert.ok(!(await failure.text()).includes('sensitive-detail'));
  state.transcribe = async () => '恢复';
  assert.equal((await route.POST(request())).status, 200);
  delete globalThis.__asrTest;
});
