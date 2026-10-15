import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { TTS_CHUNK_LENGTH } from './tts-limits';

type Node = { type: string; value?: string; url?: string; children?: Node[] };
const parser = unified().use(remarkParse).use(remarkGfm);

/** 读正文和链接标题，跳过代码块、图片、HTML 和删除线，不能把链接地址念出来。 */
export function speechText(markdown: string): string {
  function read(node: Node): string {
    if (['code', 'html', 'image', 'imageReference', 'delete', 'definition', 'footnoteDefinition', 'footnoteReference'].includes(node.type)) return '';
    if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
    if (node.type === 'break' || node.type === 'thematicBreak') return '\n';
    const parts = (node.children ?? []).map(read);
    if (node.type === 'link' && parts.join('') === node.url) return '';
    if (node.type === 'tableRow') return parts.filter(Boolean).join('，') + '\n';
    const text = parts.join('');
    return ['paragraph', 'heading', 'listItem', 'blockquote', 'table'].includes(node.type) ? text + '\n' : text;
  }
  return read(parser.parse(markdown) as Node).replace(/[\t ]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

/** 优先在句末分段，不截断长回答，也不拆开 emoji 的代理对。 */
export function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > TTS_CHUNK_LENGTH) {
    const head = remaining.slice(0, TTS_CHUNK_LENGTH);
    let end = TTS_CHUNK_LENGTH;
    const boundary = Math.max(...['。', '！', '？', '\n', '. ', '! ', '? ', '；', '; ', '，', ', ', ' '].map((mark) => {
      const index = head.lastIndexOf(mark);
      return index < 0 ? -1 : index + mark.length;
    }));
    if (boundary >= TTS_CHUNK_LENGTH / 2) end = boundary;
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    const chunk = remaining.slice(0, end).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
