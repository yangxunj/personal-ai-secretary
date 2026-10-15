import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const moduleUrl = (file, replacements = {}) => {
  let source = readFileSync(new URL(file, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  let output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const [from, to] of Object.entries(replacements)) output = output.replaceAll(from, to);
  return 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
};
const limitsUrl = moduleUrl('../src/lib/tts-limits.ts');
const ttsUrl = moduleUrl('../src/lib/tts.ts', { './tts-limits': limitsUrl });
const { getTtsConfig, synthesizeSpeech, trustedAudioUrl, TTS_MAX_AUDIO_BYTES } = await import(ttsUrl);
const speechUrl = moduleUrl('../src/lib/speech-text.ts', {
  "'unified'": JSON.stringify(import.meta.resolve('unified')),
  "'remark-parse'": JSON.stringify(import.meta.resolve('remark-parse')),
  "'remark-gfm'": JSON.stringify(import.meta.resolve('remark-gfm')),
  './tts-limits': limitsUrl,
});
const { speechText, speechChunks } = await import(speechUrl);
const config = { apiKey: 'synthetic-key', baseUrl: 'https://tts.example/api/v1', model: 'qwen3-tts-flash', voice: 'Cherry' };
const wav = new Uint8Array(100);
wav.set(Buffer.from('RIFF'), 0); wav.set(Buffer.from('WAVE'), 8);
const download = 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?Signature=synthetic';

test('Markdown speech keeps readable text without code, URLs, deleted text or metadata', () => {
  const input = '# **提醒**\n\n明天去[诊所](https://private.example/report)。\n\n```json\n{"secret":"hidden"}\n```\n\n~~已取消~~ ![图片](https://example/a.png)\n\n| 姓名 | 时间 |\n|---|---|\n| 测试用户 | 三点 |\n\n`血压`正常。';
  const plain = speechText(input);
  assert.ok(plain.includes('提醒')); assert.ok(plain.includes('诊所')); assert.ok(plain.includes('测试用户，三点'));
  for (const hidden of ['https://', 'private', 'secret', '已取消', '```', '|---|', '图片']) assert.ok(!plain.includes(hidden), hidden);
  assert.equal(speechText('```ts\nconsole.log(1)\n```'), '');
  assert.equal(speechText('查看 https://example.com/report'), '查看');
});

test('long replies split completely at bounded, Unicode-safe boundaries', () => {
  const text = ('请提醒我明天下午三点开会。😀 This is a test reply.\n').repeat(100);
  const chunks = speechChunks(text);
  assert.ok(chunks.length > 1); assert.ok(chunks.every(c => c.length <= 500 && c.length > 0));
  assert.equal(chunks.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  for (const chunk of chunks) { assert.ok(!/^[\uDC00-\uDFFF]/.test(chunk)); assert.ok(!/[\uD800-\uDBFF]$/.test(chunk)); }
  assert.equal(speechChunks('中'.repeat(499) + '😀' + '文'.repeat(20))[0].length, 499);
  assert.deepEqual(speechChunks('  '), []);
});

test('TTS configuration and audio URLs never fall back to chat/ASR secrets or arbitrary hosts', () => {
  assert.equal(getTtsConfig({ ASR_API_KEY: 'asr', AI_API_KEY: 'chat' }).apiKey, '');
  assert.equal(getTtsConfig({}).voice, 'Cherry');
  assert.equal(trustedAudioUrl(download), download.replace('http:', 'https:'));
  for (const url of ['http://127.0.0.1/x', 'https://example.com/x', 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.attacker.example/x', 'https://a:b@dashscope-result-bj.oss-cn-beijing.aliyuncs.com/x', 'file:///x']) assert.throws(() => trustedAudioUrl(url));
});

test('recording in any chat blocks speech until every recording owner has released it', async () => {
  // 只验证跨窗口协调和按钮禁用契约，音频、取消和实际播放由浏览器验收覆盖。
  const reactStub = 'data:text/javascript;base64,' + Buffer.from(`
    export const useEffect = () => {};
    export const useMemo = fn => fn();
    export const useRef = value => ({current:value});
    export const useState = value => [value, () => {}];
    export const useSyncExternalStore = (_subscribe, snapshot) => snapshot();
  `).toString('base64');
  const localeStub = 'data:text/javascript;base64,' + Buffer.from('export const useT = () => text => text;').toString('base64');
  const { default: SpeechButton, setSpeechRecording } = await import(moduleUrl('../src/components/chat/SpeechButton.tsx', {
    "'react'": JSON.stringify(reactStub), 'react/jsx-runtime': import.meta.resolve('react/jsx-runtime'),
    '@/lib/i18n/client': localeStub, '@/lib/speech-text': speechUrl,
  }));
  const blocked = () => SpeechButton({ text: '测试回答' }).props.children[0].props.disabled;
  const first = {}, second = {};
  assert.equal(blocked(), false);
  setSpeechRecording(first, true); assert.equal(blocked(), true);
  setSpeechRecording(second, false); assert.equal(blocked(), true);
  setSpeechRecording(second, true); setSpeechRecording(first, false); assert.equal(blocked(), true);
  setSpeechRecording(second, false); assert.equal(blocked(), false);
});

test('TTS request/download contract, byte limits, failures and cancellation', async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      if (calls === 1) {
        assert.equal(url, config.baseUrl + '/services/aigc/multimodal-generation/generation');
        assert.equal(options.headers.Authorization, 'Bearer synthetic-key');
        assert.deepEqual(JSON.parse(options.body), { model: config.model, input: { text: '你好', voice: 'Cherry', language_type: 'Auto' } });
        return Response.json({ output: { audio: { url: download } } });
      }
      assert.ok(url.startsWith('https://')); assert.equal(options.headers, undefined);
      return new Response(wav, { headers: { 'Content-Type': 'audio/wav' } });
    };
    assert.deepEqual(new Uint8Array(await synthesizeSpeech('你好', config)), wav);
    for (const [status, code] of [[401, 'credentials'], [403, 'credentials'], [429, 'busy'], [500, 'upstream']]) {
      globalThis.fetch = async () => new Response('sensitive', { status });
      await assert.rejects(synthesizeSpeech('你好', config), e => e.code === code && !e.message.includes('sensitive'));
    }
    globalThis.fetch = async (_url, options) => options.method === 'POST'
      ? Response.json({ output: { audio: { url: download } } })
      : new Response('not audio', { headers: { 'Content-Length': String(TTS_MAX_AUDIO_BYTES + 1) } });
    await assert.rejects(synthesizeSpeech('你好', config), e => e.code === 'upstream');
    globalThis.fetch = async () => Response.json({ output: { audio: { url: 'http://127.0.0.1/' } } });
    await assert.rejects(synthesizeSpeech('你好', config), e => e.code === 'upstream');
    const abort = new AbortController(); abort.abort();
    globalThis.fetch = async (_url, options) => options.signal.throwIfAborted();
    await assert.rejects(synthesizeSpeech('你好', config, abort.signal), e => e.name === 'AbortError');
  } finally { globalThis.fetch = original; }
});

test('TTS route enforces auth, origin, content, configuration and no-store audio response', async () => {
  const state = globalThis.__ttsTest = { authorized: true, config, calls: 0 };
  const stub = 'data:text/javascript;base64,' + Buffer.from(`
    export const sessionIsCurrent = async () => globalThis.__ttsTest.authorized;
    export const getT = async () => text => text;
    export const loadTtsConfig = async () => globalThis.__ttsTest.config;
    export const TTS_CHUNK_LENGTH = 500;
    export class TtsError extends Error {}
    export const synthesizeSpeech = async () => {globalThis.__ttsTest.calls++; return new ArrayBuffer(100);};
  `).toString('base64');
  const route = await import(moduleUrl('../src/app/api/tts/route.ts', {
    '@/lib/auth': stub, '@/lib/i18n/server': stub, '@/lib/tts-config': stub, '@/lib/tts': stub,
  }));
  const request = (body = JSON.stringify({ text: '你好' }), headers = {}) => new Request('http://localhost:1234/api/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:1234', ...headers }, body,
  });
  state.authorized = false; assert.equal((await route.POST(request())).status, 401);
  state.authorized = true;
  assert.equal((await route.POST(request(undefined, { Origin: 'https://foreign.example' }))).status, 403);
  assert.equal((await route.POST(request(undefined, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await route.POST(request('malformed'))).status, 400);
  assert.equal((await route.POST(request('{}'))).status, 400);
  assert.equal((await route.POST(request(JSON.stringify({ text: 'x'.repeat(501) })))).status, 413);
  assert.equal((await route.POST(request(' '.repeat(8193)))).status, 413);
  state.config = { ...config, apiKey: '' }; assert.equal((await route.POST(request())).status, 503);
  assert.equal(state.calls, 0);
  state.config = config;
  const response = await route.POST(request());
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.arrayBuffer()).byteLength, 100);
  assert.equal(state.calls, 1);
  delete globalThis.__ttsTest;
});
