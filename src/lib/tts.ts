export { TTS_CHUNK_LENGTH } from './tts-limits';
export const TTS_MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export type TtsConfig = { apiKey: string; baseUrl: string; model: string; voice: string };

export function getTtsConfig(env = process.env): TtsConfig {
  return {
    apiKey: (env.TTS_API_KEY ?? '').trim(),
    baseUrl: (env.TTS_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1').trim().replace(/\/+$/, ''),
    model: (env.TTS_MODEL || 'qwen3-tts-flash').trim(),
    voice: (env.TTS_VOICE || 'Cherry').trim(),
  };
}

export class TtsError extends Error {
  constructor(public code: 'credentials' | 'busy' | 'timeout' | 'network' | 'upstream') { super(code); }
}

/** 音频 URL 只在服务端消费，不把签名地址暴露给客户端，也不向下载域发送 API Key。 */
export function trustedAudioUrl(value: unknown): string {
  if (typeof value !== 'string') throw new TtsError('upstream');
  let url: URL;
  try { url = new URL(value); } catch { throw new TtsError('upstream'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
    || !/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname)) throw new TtsError('upstream');
  url.protocol = 'https:';
  return url.href;
}

export async function synthesizeSpeech(text: string, config: TtsConfig, signal?: AbortSignal): Promise<ArrayBuffer> {
  const timeout = AbortSignal.timeout(60_000);
  const combined = AbortSignal.any([timeout, ...(signal ? [signal] : [])]);
  try {
    const response = await fetch(`${config.baseUrl}/services/aigc/multimodal-generation/generation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, input: { text, voice: config.voice, language_type: 'Auto' } }),
      signal: combined, redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new TtsError([401, 403].includes(response.status) ? 'credentials' : response.status === 429 ? 'busy' : 'upstream');
    }
    const data = await response.json();
    const url = trustedAudioUrl(data?.output?.audio?.url);
    const audio = await fetch(url, { signal: combined, redirect: 'error', cache: 'no-store' });
    if (!audio.ok || Number(audio.headers.get('content-length')) > TTS_MAX_AUDIO_BYTES) {
      await audio.body?.cancel(); throw new TtsError('upstream');
    }
    const reader = audio.body?.getReader();
    if (!reader) throw new TtsError('upstream');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > TTS_MAX_AUDIO_BYTES) { await reader.cancel(); throw new TtsError('upstream'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    const tag = (at: number, label: string) => [...label].every((c, i) => result[at + i] === c.charCodeAt(0));
    if (length <= 44 || !tag(0, 'RIFF') || !tag(8, 'WAVE')) throw new TtsError('upstream');
    return result.buffer;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof TtsError) throw error;
    throw new TtsError(timeout.aborted ? 'timeout' : 'network');
  }
}
