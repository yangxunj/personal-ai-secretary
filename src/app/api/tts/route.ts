import { sessionIsCurrent } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { loadTtsConfig } from '@/lib/tts-config';
import { synthesizeSpeech, TtsError, TTS_CHUNK_LENGTH } from '@/lib/tts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 70;
let inFlight = 0;

export async function POST(req: Request) {
  const t = await getT();
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!(await sessionIsCurrent())) return fail(t('未授权'), 401);
  const expectedHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
  try {
    if (req.headers.get('origin') && new URL(req.headers.get('origin')!).host !== expectedHost) return fail(t('请求来源无效'), 403);
  } catch { return fail(t('请求来源无效'), 403); }
  if (req.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail(t('朗读请求无效'), 415);
  if (Number(req.headers.get('content-length')) > 8192) return fail(t('朗读文本过长，请分段重试'), 413);
  if (inFlight >= 3) return fail(t('语音合成正忙，请稍后重试'), 429);
  inFlight++;
  try {
    const reader = req.body?.getReader();
    if (!reader) return fail(t('没有可朗读的文字'), 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 8192) { await reader.cancel(); return fail(t('朗读文本过长，请分段重试'), 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let text: unknown;
    try { text = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.text; }
    catch { return fail(t('朗读请求无效'), 400); }
    if (typeof text !== 'string' || !text.trim()) return fail(t('没有可朗读的文字'), 400);
    if (text.length > TTS_CHUNK_LENGTH) return fail(t('朗读文本过长，请分段重试'), 413);
    const config = await loadTtsConfig();
    if (!config.apiKey) return fail(t('尚未配置语音合成服务，请在设置中填写朗读密钥'), 503);
    const audio = await synthesizeSpeech(text.trim(), config, req.signal);
    return new Response(audio, { headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(audio.byteLength), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    const code = error instanceof TtsError ? error.code : 'network';
    const messages = {
      credentials: t('朗读密钥被拒绝，请检查密钥和服务区域'),
      busy: t('语音合成正忙，请稍后重试'),
      timeout: t('语音合成超时，请重试'),
      network: t('语音合成连接失败，请检查网络后重试'),
      upstream: t('语音合成服务暂时不可用，请检查模型和音色后重试'),
    };
    return fail(messages[code], code === 'timeout' ? 504 : 502);
  } finally { inFlight--; }
}
