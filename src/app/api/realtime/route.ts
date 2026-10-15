import { createHash } from 'node:crypto';
import { sessionIsCurrent, SESSION_COOKIE } from '@/lib/auth';
import { cookies } from 'next/headers';
import { getT, getLocale } from '@/lib/i18n/server';
import { db } from '@/lib/db';
import { getChatBackend } from '@/lib/codex/config';
import { loadRealtimeConfig, validRealtimeConfig } from '@/lib/realtime/config';
import { createRealtimeSession, realtimeSessions } from '@/lib/realtime/session';
import { AUDIO_PACKET_MAX_SAMPLES } from '@/lib/realtime/transport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 1800;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function authorize(req: Request) {
  if (!(await sessionIsCurrent())) return null;
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
  if (origin) { try { if (new URL(origin).host !== host) return null; } catch { return null; } }
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value || 'local';
  return createHash('sha256').update(cookie).digest('hex');
}
async function limitedBody(req: Request, max = 16000) {
  const reader = req.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > max) { await reader.cancel(); throw new Error('Request too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function POST(req: Request) {
  const owner = await authorize(req); if (!owner) return json({ error: 'Unauthorized' }, 401);
  const t = await getT();
  try {
    if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Invalid request' }, 415);
    const body = JSON.parse(Buffer.from(await limitedBody(req)).toString('utf8'));
    if (typeof body.conversationId !== 'string' || !/^(legacy|[a-z0-9]{20,40})$/.test(body.conversationId)) return json({ error: 'Invalid conversation' }, 400);
    const config = await loadRealtimeConfig();
    if (!config.apiKey) return json({ error: t('尚未配置实时语音，请在设置中填写实时语音密钥') }, 503);
    if (!validRealtimeConfig(config)) return json({ error: t('实时语音配置无效，请检查地址、模型和音色') }, 503);
    const conversation = await db.conversation.upsert({ where: { id: body.conversationId }, create: { id: body.conversationId, backend: await getChatBackend() }, update: {} });
    if (body.taskId !== undefined && body.taskId !== conversation.taskId) return json({ error: 'Task conversation mismatch' }, 409);
    if (await db.codexTurn.findFirst({ where: { conversationId: conversation.id, status: { in: ['queued', 'running'] } } })) return json({ error: t('后台正在处理此对话，请稍后再发送') }, 409);
    const session = createRealtimeSession({ owner, conversationId: conversation.id, taskId: conversation.taskId, config, t, locale: await getLocale() });
    return json({ id: session.id });
  } catch { return json({ error: t('无法开启实时语音，请检查配置后重试') }, 400); }
}
export async function GET(req: Request) {
  const owner = await authorize(req); if (!owner) return json({ error: 'Unauthorized' }, 401);
  const session = realtimeSessions.get(new URL(req.url).searchParams.get('id') || '');
  if (!session || session.options.owner !== owner) return json({ error: 'Voice session unavailable' }, 404);
  let stop: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let ended = false;
      const end = () => { if (!ended) { ended = true; req.signal.removeEventListener('abort', stop); try { controller.close(); } catch {} } };
      stop = () => { session.close(); end(); };
      req.signal.addEventListener('abort', stop, { once: true });
      try {
        session.attach(event => {
          if (ended) return;
          if ((controller.desiredSize ?? 0) < -512) { stop(); return; }
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === 'closed') end();
        });
      } catch { end(); }
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
export async function PATCH(req: Request) {
  const owner = await authorize(req); if (!owner) return json({ error: 'Unauthorized' }, 401);
  const params = new URL(req.url).searchParams, session = realtimeSessions.get(params.get('id') || '');
  if (!session || session.options.owner !== owner) return json({ error: 'Voice session unavailable' }, 404);
  try {
    const type = req.headers.get('content-type');
    const bytes = await limitedBody(req, type === 'application/octet-stream' ? AUDIO_PACKET_MAX_SAMPLES * 2 : 16000);
    if (type === 'application/octet-stream') session.audio(bytes, Number(params.get('sequence')));
    else if (type?.startsWith('application/json')) session.control(JSON.parse(Buffer.from(bytes).toString('utf8')));
    else return json({ error: 'Invalid content type' }, 415);
    return new Response(null, { status: 204 });
  } catch {
    // 请求上传被网络中断时没有完整音频可接受，保留会话供相同序号重试。
    if (req.signal.aborted) return json({ error: 'Voice upload interrupted' }, 408);
    session.close(); return json({ error: 'Invalid voice packet' }, 400);
  }
}
export async function DELETE(req: Request) {
  const owner = await authorize(req); if (!owner) return json({ error: 'Unauthorized' }, 401);
  const session = realtimeSessions.get(new URL(req.url).searchParams.get('id') || '');
  if (session && session.options.owner !== owner) return json({ error: 'Voice session unavailable' }, 404);
  session?.close(); return new Response(null, { status: 204 });
}
