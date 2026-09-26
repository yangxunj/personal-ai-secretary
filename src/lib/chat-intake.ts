import type { UIMessage } from 'ai';
import { storeUpload, decodeDataUrl, type StoredFile } from '@/lib/ingest';
import { docKind, extractDoc } from '@/lib/doc-extract';
import { isModelImage, isTextFile, unreadableReason } from '@/lib/file-support';

/*
 * 从 api/chat/route.ts 挪出来的：这里的中文说明是**塞给模型看的**（「用户发了一张图片…」），
 * 不是界面文字，所以单独一个文件，列在 scripts/i18n-check.mjs 的 AI_FACING 里。
 */

type FilePart = { type: 'file'; url: string; mediaType?: string; filename?: string };

function isFilePart(p: unknown): p is FilePart {
  return !!p && typeof p === 'object' && (p as { type?: string }).type === 'file';
}

/**
 * 收下这一轮传上来的文件，并把消息整理成能安全喂给模型的样子。
 *
 * 两件事顺手一起做了，因为它们看的是同一批 part：
 *
 * 1. **落盘**。浏览器传上来的是 data URL，字节都在内存里；不写进 uploads/
 *    这一轮结束就没了。模型读错数字是常态，没有原件就没法回查。
 * 2. **裁掉模型看不了的东西**。图片原样送进模型；纯文本（txt/csv/json）
 *    解成文字塞进去 —— 模型看不了 file part，但看得懂文字，一份 CSV 账单
 *    这样就能读了；其余（PDF、Word）送过去 dashscope 直接报错，
 *    换成一句说明，模型至少知道「用户是传了东西的」。
 *    历史消息里的 data URL 一律裁掉：每轮把几 MB base64 重新塞一遍上下文，
 *    几轮就爆了。
 */

/** 纯文本附件的上限 40KB —— 再大就该拆，不该整份灌进上下文。哪些算纯文本见 lib/file-support.ts */
const MAX_TEXT_BYTES = 40 * 1024;
export async function intake(
  messages: UIMessage[],
  seesImages: boolean,
): Promise<{ incoming: StoredFile[]; clean: UIMessage[] }> {
  const incoming: StoredFile[] = [];
  const lastIndex = messages.length - 1;

  const clean = await Promise.all(
    messages.map(async (m, mi) => {
      if (!m.parts?.some(isFilePart)) return m;

      const parts = [];
      for (const p of m.parts) {
        if (!isFilePart(p)) {
          parts.push(p);
          continue;
        }
        const name = p.filename || '文件';
        const mediaType = p.mediaType || '';

        // 只处理最后一轮的附件：更早的轮次上一次请求已经存过了，
        // 再存一遍就是同一张图在 uploads/ 里躺两份
        let decoded: ReturnType<typeof decodeDataUrl> = null;
        if (mi === lastIndex) {
          decoded = decodeDataUrl(p.url);
          if (decoded) {
            incoming.push(await storeUpload(decoded.bytes, name, decoded.mimeType || mediaType));
          }
        }

        const type = decoded?.mimeType || mediaType;
        if (mi !== lastIndex) {
          parts.push({ type: 'text' as const, text: `［上一轮上传的文件：${name}］` });
        } else if (type.startsWith('image/') && !isModelImage(type)) {
          // HEIC 这类：原样塞给模型，整个请求会被拒（DeepSeek 只收 jpeg/png/gif/webp）
          parts.push({
            type: 'text' as const,
            text: `［用户发了一张图片：${name}（${type}），已经存档，但这种格式你看不了。${unreadableReason(type, name)}］`,
          });
        } else if (type.startsWith('image/') && seesImages) {
          parts.push(p);
        } else if (type.startsWith('image/')) {
          // DeepSeek 官方这类纯文本接口：消息里带一张图，整个请求直接 400。
          // 原件上面已经存进 uploads/ 了，这里只告诉模型「有图但你看不了」。
          parts.push({
            type: 'text' as const,
            text: `［用户发了一张图片：${name}，已经存档。当前模型看不了图片，别猜内容 —— 让用户把关键内容打字说一下，或者到设置里换一个能看图的模型（比如 deepseek-flash）］`,
          });
        } else if (decoded && isTextFile(type, name)) {
          const truncated = decoded.bytes.byteLength > MAX_TEXT_BYTES;
          const body = new TextDecoder().decode(decoded.bytes.slice(0, MAX_TEXT_BYTES));
          parts.push({
            type: 'text' as const,
            text: `［用户上传的文件 ${name} 的内容${truncated ? '（太长，只截了开头一段）' : ''}］\n${body}`,
          });
        } else if (decoded && docKind(type, name)) {
          // PDF / Word / Excel：服务器先拆成文字（扫描件拆成页面图片）再给模型。
          // 模型自己没有读文件的工具，不在这里拆它就只能看到一个文件名。
          try {
            const doc = await extractDoc(docKind(type, name)!, decoded.bytes, seesImages);
            parts.push({
              type: 'text' as const,
              text: `［用户上传的文件 ${name}：${doc.note}］${doc.text ? `
${doc.text}` : ''}`,
            });
            doc.pages.forEach((png, i) =>
              parts.push({
                type: 'file' as const,
                mediaType: 'image/png',
                filename: `${name} 第 ${i + 1} 页`,
                url: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
              }),
            );
          } catch (e) {
            console.error('[chat] 文档解析失败', name, e);
            parts.push({
              type: 'text' as const,
              // 加密的 PDF、损坏的文件都会走到这里
              text: `［用户上传了文件：${name}，但解析失败（可能加密或损坏），你看不到内容。让用户截图发过来］`,
            });
          }
        } else {
          parts.push({
            type: 'text' as const,
            // 说清「看不了」，否则模型会假装读过然后编内容
            text: `［用户上传了文件：${name}（${type || '未知类型'}）。这种格式读不了（支持图片、PDF、.docx、.xlsx、txt/csv），需要的话让用户截图或另存成这些格式］`,
          });
        }
      }
      return { ...m, parts } as UIMessage;
    })
  );

  return { incoming, clean };
}
