import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { UPLOAD_DIR } from '@/lib/storage';

/**
 * 网页这一侧的「收文件」。
 *
 * CLI 那边的 `ingestFile` 是从磁盘复制（主人把文件拖给 Claude Code，落在
 * ~/.claude/uploads 里）；这边是从浏览器传上来的字节流。目录结构、命名规则
 * 保持一致 —— 同一个 uploads/ 目录，备份脚本整包打走，两个入口不能各建各的。
 */

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/json': '.json',
};

export type StoredFile = {
  filename: string;
  storedPath: string;
  mimeType: string;
  size: number;
};

/**
 * 把一份上传的文件写进 data/uploads/<年-月>/。
 *
 * 文件名前面加 8 位随机前缀：同一个月传两张都叫「账单.jpg」的图不会互相覆盖。
 * Windows 不允许的字符统一换成下划线 —— 手机相册里的文件名什么都有。
 */
export async function storeUpload(
  bytes: Uint8Array,
  filename: string,
  mimeType: string
): Promise<StoredFile> {
  const now = new Date();
  const bucket = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await mkdir(path.join(UPLOAD_DIR, bucket), { recursive: true });

  let base = (filename || 'upload').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  if (!path.extname(base)) base += MIME_EXT[mimeType] ?? '';

  const stored = path.join(bucket, `${randomUUID().slice(0, 8)}-${base}`);
  await writeFile(path.join(UPLOAD_DIR, stored), bytes);

  return {
    filename: base,
    storedPath: stored.replace(/\\/g, '/'),
    mimeType: mimeType || 'application/octet-stream',
    size: bytes.byteLength,
  };
}

/** data:image/png;base64,xxx → 字节。AI SDK 的 file part 就是这个形状 */
export function decodeDataUrl(url: string): { bytes: Uint8Array; mimeType: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const mimeType = m[1] || 'application/octet-stream';
  const bytes = m[2]
    ? new Uint8Array(Buffer.from(m[3], 'base64'))
    : new Uint8Array(Buffer.from(decodeURIComponent(m[3]), 'utf8'));
  return { bytes, mimeType };
}

/**
 * 删掉一批存过的文件（数据库行由调用方删）。
 *
 * 重导一期账单时旧原件要跟着走 —— 不删就是同一份账单在页面上挂三张图，
 * 而且分不清哪张对应现在库里的数字。磁盘上的字节也要删：只删数据库行，
 * uploads/ 会慢慢堆满谁也不认识的文件，还跟着每天的备份一起打包走。
 */
export async function removeStored(storedPaths: string[]): Promise<void> {
  const { unlink } = await import('node:fs/promises');
  for (const p of storedPaths) {
    // 删不掉不该让整个导入失败 —— 文件早被手工删了是常见情况
    await unlink(path.join(UPLOAD_DIR, p)).catch(() => {});
  }
}
