/**
 * 把 PDF / Word / Excel 转成模型看得懂的东西。
 *
 * 模型只收两样：文字和图片。PDF、Word 是文件格式，得有人先拆开 ——
 * pi / Claude Code 是 AI 自己调命令行去拆（它们有 bash），我们的 AI 没有
 * 读文件、跑命令的工具，所以由服务器在收到文件时替它拆好，塞进这一轮的消息里。
 *
 *   电子版 PDF  → 抽文字（unpdf，PDF.js 的封装）
 *   扫描版 PDF  → 里面没有文字层，每页渲染成图片给模型看（@napi-rs/canvas）
 *   .docx       → 抽文字（mammoth）
 *   .xlsx       → 每张表转 CSV（SheetJS）
 *
 * 旧的 .doc / .xls 是二进制格式，不支持 —— 让用户另存成新格式或截图。
 */

/** 抽出来的文字最多留多少。跟纯文本附件同一个口径 */
export const MAX_TEXT_CHARS = 40 * 1024;
/** 扫描件最多渲染几页。一页一张图，太多了这一轮就很贵 */
const MAX_SCAN_PAGES = 5;
/** 平均每页少于这么多字，就当它是扫描件（只有页眉页码那点字的也算） */
const SCAN_CHARS_PER_PAGE = 50;
/** 渲染倍率。1.0 是 72dpi，小字看不清；2.0 约 144dpi，体检报告的小数点看得清 */
const RENDER_SCALE = 2;

export type DocKind = 'pdf' | 'docx' | 'xlsx';

const EXT: Record<string, DocKind> = { pdf: 'pdf', docx: 'docx', xlsx: 'xlsx' };
const MIME: Record<string, DocKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/** 按 MIME 认，认不出再看扩展名（Windows 上有时传过来是空的或 octet-stream） */
export function docKind(mimeType: string, filename: string): DocKind | null {
  if (MIME[mimeType]) return MIME[mimeType];
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return EXT[ext] ?? null;
}

export type Extracted = {
  /** 给模型的文字（已截断），没抽到就是空串 */
  text: string;
  /** 扫描件渲染出的页面，PNG */
  pages: Uint8Array[];
  /** 给模型的一句说明：总共几页、截没截断、渲染了几页 */
  note: string;
};

function clip(text: string): { text: string; clipped: boolean } {
  const t = text.trim();
  return t.length > MAX_TEXT_CHARS ? { text: t.slice(0, MAX_TEXT_CHARS), clipped: true } : { text: t, clipped: false };
}

async function fromPdf(bytes: Uint8Array, renderScans: boolean): Promise<Extracted> {
  const { getDocumentProxy, extractText, renderPageAsImage } = await import('unpdf');
  // PDF.js 会把传进去的 buffer 转移走（detach），后面还要用原始字节存盘，所以给它一份拷贝
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const plain = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const scanned = plain.replace(/\s/g, '').length < totalPages * SCAN_CHARS_PER_PAGE;

  if (!scanned) {
    const c = clip(plain);
    return {
      text: c.text,
      pages: [],
      note: `共 ${totalPages} 页，已抽出文字${c.clipped ? '（太长，只截了开头一段）' : ''}`,
    };
  }

  // 扫描件：文字层基本是空的，只能让模型看图
  if (!renderScans) {
    return {
      text: '',
      pages: [],
      note: `共 ${totalPages} 页，是扫描件（没有文字层），当前模型看不了图片，读不出内容`,
    };
  }
  const n = Math.min(totalPages, MAX_SCAN_PAGES);
  const pages: Uint8Array[] = [];
  for (let i = 1; i <= n; i++) {
    const png = await renderPageAsImage(pdf, i, {
      canvasImport: () => import('@napi-rs/canvas'),
      scale: RENDER_SCALE,
    });
    pages.push(new Uint8Array(png));
  }
  return {
    text: plain.trim(),
    pages,
    note: `共 ${totalPages} 页，是扫描件，已把${n < totalPages ? `前 ${n}` : `全部 ${n}`} 页转成图片${
      n < totalPages ? `（后面 ${totalPages - n} 页没发，需要的话让用户截图）` : ''
    }`,
  };
}

async function fromDocx(bytes: Uint8Array): Promise<Extracted> {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const c = clip(value.replace(/\n{3,}/g, '\n\n'));
  return { text: c.text, pages: [], note: `Word 文档，已抽出文字${c.clipped ? '（太长，只截了开头一段）' : ''}` };
}

async function fromXlsx(bytes: Uint8Array): Promise<Extracted> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  const sheets = wb.SheetNames.map((name) => {
    // 空行去掉：很多表格下面拖着几百行格式化过的空行
    const csv = XLSX.utils
      .sheet_to_csv(wb.Sheets[name], { blankrows: false })
      .split('\n')
      .filter((l) => l.replace(/,/g, '').trim())
      .join('\n');
    return `## 工作表：${name}\n${csv}`;
  });
  const c = clip(sheets.join('\n\n'));
  return {
    text: c.text,
    pages: [],
    note: `Excel，${wb.SheetNames.length} 张工作表，已转成 CSV${c.clipped ? '（太长，只截了开头一段）' : ''}`,
  };
}

export async function extractDoc(kind: DocKind, bytes: Uint8Array, renderScans: boolean): Promise<Extracted> {
  if (kind === 'pdf') return fromPdf(bytes, renderScans);
  if (kind === 'docx') return fromDocx(bytes);
  return fromXlsx(bytes);
}
