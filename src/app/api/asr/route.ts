import { sessionIsCurrent } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { transcribeVoice, AsrError } from '@/lib/asr';
import { loadAsrConfig } from '@/lib/asr-config';
import { validVoiceWav, VOICE_MAX_BYTES } from '@/lib/voice-audio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 单用户实例一次只识别一段，防止重复点击产生并行计费。
let recognizing = false;

export async function POST(req: Request) {
  const t = await getT();
  const fail = (message: string, status: number) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!(await sessionIsCurrent())) return fail(t('未授权'), 401);
  const expectedHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
  try {
    if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== expectedHost) return fail(t('请求来源无效'), 403);
  } catch { return fail(t('请求来源无效'), 403); }
  if (req.headers.get('content-type')?.split(';')[0] !== 'audio/wav') return fail(t('录音格式不支持，请重新录音'), 415);
  if (Number(req.headers.get('content-length')) > VOICE_MAX_BYTES) return fail(t('录音太大，每段最多 60 秒'), 413);
  const config = await loadAsrConfig();
  if (!config.apiKey) return fail(t('尚未配置语音识别服务，请在设置中填写语音识别密钥'), 503);
  if (recognizing) return fail(t('语音识别正忙，请稍后重试'), 429);
  recognizing = true;
  try {
    // 流式检查实际字节数，避免没有 Content-Length 的请求撑大内存。
    const reader = req.body?.getReader();
    if (!reader) return fail(t('录音为空，请重新录音'), 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > VOICE_MAX_BYTES) { await reader.cancel(); return fail(t('录音太大，每段最多 60 秒'), 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const audio = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.length; }
    if (!validVoiceWav(audio.buffer)) return fail(t('录音无效或太短，请重新录音'), 400);
    const text = await transcribeVoice(audio.buffer, config, req.signal);
    return Response.json({ text }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof AsrError ? error.code : 'network';
    const messages = {
      credentials: t('语音识别密钥被拒绝，请检查密钥和服务区域'),
      quota: t('语音识别额度不足，请检查服务账户'),
      busy: t('语音识别正忙，请稍后重试'),
      timeout: t('语音识别超时，请重试'),
      network: t('语音识别连接失败，请检查网络后重试'),
      upstream: t('语音识别服务暂时不可用，请重试或检查模型配置'),
      empty: t('没有识别到文字，请靠近麦克风重新录音'),
    };
    return fail(messages[code], code === 'empty' ? 422 : code === 'timeout' ? 504 : 502);
  } finally { recognizing = false; }
}
