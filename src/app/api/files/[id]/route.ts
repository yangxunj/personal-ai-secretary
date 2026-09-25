import { NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { db } from '@/lib/db';
import { absolutePath, THUMB_DIR } from '@/lib/storage';
import { verifySessionValue } from '@/lib/session-edge';
import { sessionIsCurrent, SESSION_COOKIE } from '@/lib/auth';
import { cookies } from 'next/headers';

/**
 * 附件下载 / 显示。
 *
 * **`?w=<宽度>` 会返回缩过的图**，只给缩略图用。不带参数一律返回原件 ——
 * 证件上的号码、体检报告上的小字，缩过就等于没存。
 *
 * 为什么要有这个参数：资料页的图片墙是 96×96 的小方块，但原来 `<img>` 直接
 * 指向原件，等于为了画 7 个指甲盖大的缩略图，把 5 MB 的证件扫描件全下下来
 * （最大的一张 2.17 MB）。在电脑上看不出来，手机走 Tailscale 就是几秒的白屏。
 */

/** 只认这几个宽度。开放任意值等于让人用 ?w=1、?w=2、?w=3… 把磁盘塞满。 */
const ALLOWED_WIDTHS = [240, 480];

async function thumbnail(storedPath: string, id: string, width: number) {
  // 缩完存盘：2 MB 的扫描件每次重新编码要一百多毫秒，而附件一旦入库就不会变，
  // 缓存不存在失效问题。
  const cached = path.join(THUMB_DIR, `${id}-${width}.jpg`);
  try {
    return await readFile(cached);
  } catch {
    // 没缓存，下面现做
  }
  const buf = await sharp(absolutePath(storedPath))
    .rotate() // 按 EXIF 摆正 —— 手机拍的证件不转会躺着
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
  await mkdir(THUMB_DIR, { recursive: true });
  await writeFile(cached, buf);
  return buf;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // 与 middleware 一致：启用鉴权时，文件接口也要单独校验一次
  // （否则知道 id 就能绕过页面直接取走账单）
  if (process.env.AUTH_ENABLED === 'true') {
    const jar = await cookies();
    const ok = await verifySessionValue(
      jar.get(SESSION_COOKIE)?.value,
      process.env.SESSION_SECRET ?? ''
    );
    if (!ok) return new NextResponse('未授权', { status: 401 });
    // 签名对不代表还算数 —— 密码改过之后旧 cookie 要当场作废。
    // 页面那边在 layout 里验，这儿是 API，不走 layout，必须自己再验一次。
    if (!(await sessionIsCurrent())) return new NextResponse('未授权', { status: 401 });
  }

  const { id } = await params;
  const file = await db.attachment.findUnique({ where: { id } });
  if (!file) return new NextResponse('文件不存在', { status: 404 });

  const asked = Number(new URL(req.url).searchParams.get('w'));
  const width = ALLOWED_WIDTHS.includes(asked) ? asked : null;
  const wantThumb = width !== null && file.mimeType.startsWith('image/');

  try {
    if (wantThumb) {
      const buf = await thumbnail(file.storedPath, file.id, width);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'image/jpeg',
          // 缩略图按 id + 宽度取，内容永不变，可以让浏览器长期留着
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    }

    const buf = await readFile(absolutePath(file.storedPath));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('文件已丢失', { status: 410 });
  }
}
