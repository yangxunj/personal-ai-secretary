import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { db } from '@/lib/db';
import { getAiConfig } from '@/lib/ai-config';

/**
 * 多个对话：列表、改名、删除、自动起标题。
 *
 * 数据上的规矩（schema.prisma 的 Conversation 那段有来由）：
 * - 对话页里说的话都挂在某个对话上；任务页的留言不挂，只在任务页看
 * - 上下文和压缩摘要按对话分开（lib/chat-context.ts）
 */

export type ConversationItem = {
  id: string;
  /** 起好的标题；还没起的时候是第一句话截一段 */
  title: string;
  /** 标题是不是还只是第一句话（AI 还没起） */
  provisional: boolean;
  updatedAt: string;
};

/** 标题的长度上限。列表那一栏 16rem 宽，一行放得下十几个字 */
const TITLE_MAX = 20;

function clip(s: string, n = TITLE_MAX) {
  const t = s.replace(/\s+/g, ' ').trim();
  return [...t].length > n ? [...t].slice(0, n).join('') + '…' : t;
}

export async function listConversations(): Promise<ConversationItem[]> {
  const rows = await db.conversation.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 300,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      messages: { where: { role: 'user' }, orderBy: { createdAt: 'asc' }, take: 1, select: { content: true } },
    },
  });
  return rows
    // 点了「新对话」、发出去之前就关了页面 —— 那种空壳不上列表
    .filter((r) => r.title || r.messages.length)
    .map((r) => ({
      id: r.id,
      title: r.title ?? clip(r.messages[0]?.content ?? '新对话'),
      provisional: !r.title,
      updatedAt: r.updatedAt.toISOString(),
    }));
}

export async function renameConversation(id: string, title: string) {
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!t) return;
  const cur = await db.conversation.findUnique({ where: { id }, select: { updatedAt: true } });
  if (!cur) return;
  // 显式带上原来的 updatedAt：@updatedAt 会自动刷新，改个名这个对话就跳到列表最上面去了
  await db.conversation.update({ where: { id }, data: { title: t, updatedAt: cur.updatedAt } });
}

/**
 * 删一个对话：它的消息和摘要一起删。
 *
 * 但**挂在任务上的消息不删**，只把它从对话里摘出来 —— 那是任务的来龙去脉，
 * 任务页还要显示。（「以前的对话」里就有不少这种：迁移前任务页的留言也显示在对话页里。）
 * 附件跟着外键 SetNull 留在文件页；对话里建的任务、存的资料本来就在各自的表里，不受影响。
 */
export async function deleteConversation(id: string) {
  await db.$transaction([
    db.message.updateMany({ where: { conversationId: id, taskId: { not: null } }, data: { conversationId: null } }),
    db.message.deleteMany({ where: { conversationId: id } }),
    db.chatSummary.deleteMany({ where: { conversationId: id } }),
    db.conversation.deleteMany({ where: { id } }),
  ]);
}

/**
 * 第一轮聊完，让模型起个标题。
 *
 * 用的是前端传来的这一轮原文，不从库里读：前端的「这一轮结束了」和服务端
 * 「这一轮写进库了」不是同一时刻，从库里读有可能还没写进去。
 * 已经有标题的（用户改过名、或者已经起过）不动。模型调不通就退回第一句话。
 */
export async function autoTitle(id: string, user: string, reply: string): Promise<string | null> {
  const conv = await db.conversation.findUnique({ where: { id }, select: { title: true } });
  if (!conv) return null;
  if (conv.title) return conv.title;

  let title = '';
  const cfg = await getAiConfig();
  if (cfg.apiKey && cfg.baseUrl && cfg.model) {
    try {
      const provider = createOpenAICompatible({ name: 'ai', baseURL: cfg.baseUrl, apiKey: cfg.apiKey });
      const { text } = await generateText({
        model: provider.chatModel(cfg.model),
        system:
          '给一段对话起个标题，用来在对话列表里认出它。' +
          '中文，4 到 12 个字，说清是哪件事（比如「车险续保比价」「妈妈体检报告」）。' +
          '只输出标题本身，不要引号、不要句号、不要解释。',
        prompt: `用户：${user.slice(0, 1500)}\n\n助手：${reply.slice(0, 1500)}`,
        // 推理模型要先想一会儿，给小了正文是空的
        maxOutputTokens: 1024,
      });
      title = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
      title = title.replace(/^(标题[:：]\s*)/, '').replace(/^["'「『《]+|["'」』》。.！!]+$/g, '').trim();
    } catch (e) {
      console.error('[chat] 起标题失败，用第一句话代替', e);
    }
  }
  if (!title) title = clip(user) || '新对话';
  title = clip(title, 30);

  // 用户在这期间手动改了名的话，别覆盖
  await db.conversation.updateMany({ where: { id, title: null }, data: { title } });
  return (await db.conversation.findUnique({ where: { id }, select: { title: true } }))?.title ?? title;
}

/** 新对话的 id：页面上先生成好，第一句话发出去时服务端照这个 id 建 */
export function newConversationId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
