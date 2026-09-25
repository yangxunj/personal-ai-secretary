/**
 * AI 读得了哪些文件。页面（选文件时就提示）和服务端（决定怎么喂给模型）共用这一份，
 * 两边说法不一致的话，页面说「能读」、发出去 AI 却说「读不了」。
 *
 * 不引任何服务端依赖 —— Chat.tsx 是客户端组件，要打进浏览器。
 */

/** 模型直接收的图片格式。DeepSeek 官方文档列的就这四种；iPhone 的 HEIC 不在里面 */
export const MODEL_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const DOC_EXT = ['pdf', 'docx', 'xlsx'];
const TEXT_EXT = ['txt', 'csv', 'json', 'md'];

function ext(name: string) {
  return name.toLowerCase().split('.').pop() ?? '';
}

/**
 * 当纯文本读。按扩展名也认：Windows 上浏览器常把 .csv 报成 application/vnd.ms-excel，
 * .md 报成空串 —— 只看 MIME 的话，页面说能读、服务端却当成读不了的格式。
 */
export function isTextFile(mimeType: string, name: string) {
  const t = mimeType.toLowerCase();
  return TEXT_EXT.includes(ext(name)) || t.startsWith('text/') || t === 'application/json';
}

export function isModelImage(mimeType: string) {
  return MODEL_IMAGE_TYPES.includes(mimeType.toLowerCase());
}

/** 读不了的话返回一句给人看的原因；读得了返回 null */
export function unreadableReason(mimeType: string, name: string): string | null {
  const t = mimeType.toLowerCase();
  const e = ext(name);
  if (isModelImage(t)) return null;
  if (t === 'image/heic' || t === 'image/heif' || e === 'heic' || e === 'heif') {
    return 'HEIC 照片 AI 看不了，iPhone 上可以截个图再发，或者设置里把照片格式改成「兼容性最佳」';
  }
  if (t.startsWith('image/')) return '这种图片格式 AI 看不了，截个图（PNG/JPG）再发';
  if (DOC_EXT.includes(e) || t === 'application/pdf') return null;
  if (isTextFile(t, name)) return null;
  if (e === 'doc' || e === 'xls' || e === 'ppt') {
    return `旧版 .${e} 读不了，另存成 .${e}x 再发，或者截图`;
  }
  return '这种格式 AI 读不了，发出去只会存档。能读的：图片、PDF、Word(.docx)、Excel(.xlsx)、txt/csv';
}
