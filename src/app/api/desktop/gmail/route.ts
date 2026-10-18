import { timingSafeEqual } from 'node:crypto';
import { mailCommand } from '@/lib/mail/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const expected = process.env.DESKTOP_GMAIL_TOKEN;
  const received = req.headers.get('x-desktop-gmail') || '';
  if (process.env.DESKTOP_APP !== '1' || !expected || Buffer.byteLength(received) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(received), Buffer.from(expected)))
    return Response.json({ error: 'MAIL_DESKTOP_ONLY' }, { status: 403 });
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const text = await req.text(); if (text.length > 8000) throw new Error('MAIL_INVALID_INPUT');
    const { action, input } = JSON.parse(text);
    return Response.json(await mailCommand(action, input), { headers });
  } catch (error: any) {
    const code = /^MAIL_[A-Z_]+$/.test(error?.message || '') ? error.message : 'MAIL_OPERATION_FAILED';
    return Response.json({ error: code }, { status: 400, headers });
  }
}
