import { NextResponse } from 'next/server';
import { sessionIsCurrent } from '@/lib/auth';
import { getData, listKeys, removeData, setData } from '@/lib/page-data';

/**
 * 页面存储的读写口。**只有平台页面（PageFrame）调它**，沙箱里的页面脚本调不到 ——
 * 它没有 origin、也带不上 cookie。pageId 来自 URL，由 PageFrame 按自己展示的那一页填，
 * 页面脚本通过 postMessage 只能说「读/写哪个 key」，说不了「哪一页」。
 *
 * POST { op: 'get' | 'set' | 'remove' | 'keys', key?, value? }
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await sessionIsCurrent())) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  let body: { op?: string; key?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  const key = typeof body.key === 'string' ? body.key : '';
  switch (body.op) {
    case 'get':
      return NextResponse.json(await getData(id, key));
    case 'set':
      return NextResponse.json(await setData(id, key, body.value));
    case 'remove':
      return NextResponse.json(await removeData(id, key));
    case 'keys':
      return NextResponse.json({ ok: true, value: (await listKeys(id)).map((k) => k.key) });
    default:
      return NextResponse.json({ ok: false, error: 'unknown op' }, { status: 400 });
  }
}
