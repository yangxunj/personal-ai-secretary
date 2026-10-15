export type AsrConfig = { apiKey: string; baseUrl: string; model: string };

/** 与聊天配置分开，切换聊天提供商或 Codex 后端不影响语音输入。 */
export function getAsrConfig(env = process.env): AsrConfig {
  return {
    apiKey: (env.ASR_API_KEY ?? '').trim(),
    baseUrl: (env.ASR_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').trim().replace(/\/+$/, ''),
    model: (env.ASR_MODEL || 'qwen3-asr-flash').trim(),
  };
}

export class AsrError extends Error {
  constructor(public code: 'credentials' | 'quota' | 'busy' | 'timeout' | 'network' | 'upstream' | 'empty') {
    super(code);
  }
}

export async function transcribeVoice(audio: ArrayBuffer, config: AsrConfig, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: {
          data: `data:audio/wav;base64,${Buffer.from(audio).toString('base64')}`,
        } }] }],
        stream: false,
        asr_options: { enable_itn: true },
      }),
      signal: AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])]),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AsrError(error instanceof Error && /timeout|abort/i.test(error.name) ? 'timeout' : 'network');
  }
  // 不把上游原文返回给浏览器：服务商报错可能包含敏感配置。
  if (!response.ok) {
    await response.body?.cancel();
    throw new AsrError(response.status === 401 || response.status === 403 ? 'credentials'
      : response.status === 402 ? 'quota' : response.status === 429 ? 'busy' : 'upstream');
  }
  let data: { choices?: { message?: { content?: unknown } }[] };
  try { data = await response.json(); } catch { throw new AsrError('upstream'); }
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new AsrError('upstream');
  if (!text.trim()) throw new AsrError('empty');
  return text.trim();
}
