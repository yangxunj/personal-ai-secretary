import path from 'node:path';

export const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';

// 文件由管家从 CLI 侧收入（scripts/secretary.mjs 的 ingestFile），
// 网页只负责展示和下载。

/**
 * 缩略图缓存。**故意放在 uploads/ 外面** —— 备份脚本是整个 uploads/ 打包走的，
 * 而缩略图删了随时能再生成，没必要占备份空间。删掉整个目录是安全操作。
 */
export const THUMB_DIR = path.join(UPLOAD_DIR, '..', '.thumbs');

export function absolutePath(storedPath: string) {
  return path.join(UPLOAD_DIR, storedPath);
}
