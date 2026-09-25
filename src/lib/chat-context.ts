/**
 * 对话的上下文管理：每一轮发给模型什么、快满了怎么压缩。
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────────────────
 * 原来发给模型的只有「这次打开页面之后说过的话」（useChat 的内存状态）：
 * 刷新就失忆，而同一次打开聊一整天，每轮又把全部历史重发一遍，越聊越贵。
 * 现在每一轮从数据库拼上下文（**按对话**：每个对话各拼各的、各压各的）：
 *
 *     系统提示 + 最新一份摘要 + 摘要之后的原文 + 这一轮的新消息
 *
 * 原文估算超过预算就压缩：早期那段交给模型总结，续写进摘要，只留最近一段原文。
 *
 * ── 移植自 pi ────────────────────────────────────────────────────────────────
 * 压缩算法和摘要格式移植自 pi-mono 的 coding-agent
 * （packages/coding-agent/src/core/compaction/，MIT License，
 * Copyright (c) 2025 Mario Zechner）。拿过来的：
 *   - 触发条件：上下文 > 预算 − 预留（shouldCompact）
 *   - 切点：从最新往回累加，攒够 keepRecent 就停，只在用户开口处切（findCutPoint）
 *   - 结构化摘要 + 续写规则：第二次压缩把上一份摘要带进去合并（UPDATE_SUMMARIZATION_*）
 *   - 喂给摘要模型的是纯文本，工具结果截到 2000 字（serializeConversation）
 * 没拿的：文件读写追踪、分支总结、扩展钩子、JSONL 会话文件 —— 那是写代码场景的。
 * 改了的：摘要各节换成家务口径；token 估算对中文单独算（pi 的「字数 ÷ 4」是英文口径，
 * 中文一个字差不多就是一个 token，照搬会低估三四倍）。
 * 也没做 pi 的「模型报超长 → 压缩后重试」：我们的预算（20 万）比模型窗口（100 万）
 * 小得多，走不到那一步；接小窗口的自定义模型时再补。
 */
import { generateText, pruneMessages, type LanguageModel, type ModelMessage } from 'ai';
import { db } from '@/lib/db';

// ── 预算 ────────────────────────────────────────────────────────────────────
// 比模型窗口（100 万）小：每一轮都要把整段上下文重发一遍，上下文越长每轮越贵。
// 第一版定的 6.4 万，用户觉得太短（2026-09-23 调到 20 万）—— 原文留得多，
// 「上周聊的那个细节」更可能还在原文里，而不是只剩摘要里的一句。

/**
 * 我们允许的上下文上限（估算 token）。
 * `CHAT_CONTEXT_BUDGET` 只给测试用：调到几千，聊三五轮就能看到压缩。
 */
export const CONTEXT_BUDGET = Number(process.env.CHAT_CONTEXT_BUDGET) || 200_000;
/** 给这一轮的回复和工具往来留的余量。pi 的默认值；测试时预算调得很小，按比例缩 */
const RESERVE_TOKENS = Math.min(16_384, Math.round(CONTEXT_BUDGET * 0.256));
/** 压缩后至少保留这么多最近的原文。pi 的默认值；同上 */
const KEEP_RECENT_TOKENS = Math.min(20_000, Math.round(CONTEXT_BUDGET * 0.3125));
/** 摘要请求自己的输出上限 */
const SUMMARY_MAX_TOKENS = 8_192;
/** 喂给摘要模型时，单个工具结果最多留多少字 */
const TOOL_RESULT_MAX_CHARS = 2_000;
/**
 * 还没有任何摘要时，最多往回看多少原文。上线前积攒的几百条历史，
 * 第一次压缩时不该整个喂给摘要模型 —— 更早的那些不管了。
 */
const FIRST_COMPACT_LOOKBACK = CONTEXT_BUDGET;

// ── token 估算 ──────────────────────────────────────────────────────────────

/**
 * 粗估 token 数。中日韩字符按 1 个算，其余按 4 个字符 1 个算。
 * 实际 DeepSeek 一个汉字不到 1 个 token，这样估偏大 —— 偏大只会早点压缩，
 * 偏小才会真超。
 *
 * 为什么不用接口返回的 usage（pi 是用的）：百炼开了联网搜索，搜索结果算在
 * 输入 token 里（实测一问天气从 53 涨到 3000 多），但下一轮并不会再带上它们。
 * 拿它当「下一轮上下文有多大」会严重高估。
 */
export function estimateTextTokens(s: string): number {
  let cjk = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xff00 && c <= 0xffef)) cjk++;
  }
  const other = [...s].length - cjk;
  return cjk + Math.ceil(other / 4);
}

/** 一张图大概占多少 token。pi 按 4800 字符算，折成 token 取 1200 */
const IMAGE_TOKENS = 1_200;

function partText(p: unknown): string {
  if (!p || typeof p !== 'object') return String(p ?? '');
  const x = p as Record<string, unknown>;
  switch (x.type) {
    case 'text':
    case 'reasoning':
      return String(x.text ?? '');
    case 'tool-call':
      return `${x.toolName}(${JSON.stringify(x.input ?? {})})`;
    case 'tool-result':
      return outputText(x.output);
    default:
      return '';
  }
}

function outputText(output: unknown): string {
  if (!output || typeof output !== 'object') return String(output ?? '');
  const o = output as { type?: string; value?: unknown };
  if (o.type === 'text' || o.type === 'error-text') return String(o.value ?? '');
  if ('value' in o) return JSON.stringify(o.value);
  return JSON.stringify(output);
}

export function estimateMessageTokens(m: ModelMessage): number {
  if (typeof m.content === 'string') return estimateTextTokens(m.content) + 4;
  let n = 4;
  for (const p of m.content as unknown[]) {
    const t = (p as { type?: string })?.type;
    n += t === 'image' || (t === 'file' && String((p as { mediaType?: string }).mediaType).startsWith('image/'))
      ? IMAGE_TOKENS
      : estimateTextTokens(partText(p));
  }
  return n;
}

const sum = (ms: ModelMessage[]) => ms.reduce((a, m) => a + estimateMessageTokens(m), 0);

// ── 数据库里的消息 → 模型消息 ────────────────────────────────────────────────

type Row = {
  id: string;
  role: string;
  sender: string | null;
  content: string;
  modelJson: string | null;
  createdAt: Date;
  attachments: { filename: string }[];
  task: { title: string } | null;
};

const ROW_SELECT = {
  id: true,
  role: true,
  sender: true,
  content: true,
  modelJson: true,
  createdAt: true,
  attachments: { select: { filename: true } },
  task: { select: { title: true } },
} as const;

/**
 * 一条库里的消息变成发给模型的样子。
 *
 * - 用户消息：文字 + 附件的名字。**更早轮次的图片不再发原图** —— 跟以前一样，
 *   每轮重发几 MB 的 base64 几轮就爆了；模型要看，让用户再发一次。
 * - 管家消息：有 modelJson 就用它（带着工具调用和结果，下一轮才知道刚才建的
 *   任务 id 是什么）；没有的（上线前的、种子数据）退回成一段纯文本。
 * - 任务页上的留言也在这张表里，带上它关联的任务名，模型才知道在说哪件事。
 */
export function rowToModelMessages(r: Row): ModelMessage[] {
  if (r.role === 'secretary') {
    if (r.modelJson) {
      try {
        const parsed = JSON.parse(r.modelJson) as ModelMessage[];
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch {
        // 坏了就当没有，退回纯文本
      }
    }
    return [{ role: 'assistant', content: r.content }];
  }

  const bits = [r.content];
  if (r.attachments.length) {
    bits.push(`［附件：${r.attachments.map((a) => a.filename).join('、')}（原件已存档，这里看不到内容）］`);
  }
  const who = r.sender ? `［${r.sender}说］` : '';
  const where = r.task ? `［在任务「${r.task.title}」下留言］` : '';
  return [{ role: 'user', content: `${where}${who}${bits.join('\n')}` }];
}

/**
 * 存进 modelJson 之前的清理：去掉推理过程。
 *
 * DeepSeek 的思考内容只在同一轮的工具循环里需要回传（那部分 streamText 自己管），
 * 跨轮不用带；而它是整轮里最长的部分，留着纯属烧钱。
 *
 * 同一个道理还要去掉**大块的工具往来**（shrinkToolParts）。
 */
export function toStoredModelJson(messages: ModelMessage[]): string | null {
  const pruned = pruneMessages({ messages, reasoning: 'all', emptyMessages: 'remove' });
  return pruned.length ? JSON.stringify(shrinkToolParts(pruned)) : null;
}

/** 工具结果超过这么长就不整段进历史。查询工具一次返回上百笔交易是常事 */
const MAX_STORED_RESULT_CHARS = 6000;

/**
 * 做一个页面，savePage 的参数就是一整页 HTML（二三十 KB）；改页面前 getPage
 * 又取回一整页。原样存进历史的话，此后**每一轮**都要把这几页重新喂给模型 ——
 * 做三个页面，随便聊一句也是几万 token。
 *
 * 所以存的时候换成一句占位：模型知道「这里做过一个页面、id 是什么」就够了，
 * 真要改会按提示词先 getPage 取原文。查询工具的大结果同理：留个开头，
 * 要细看就再查一次 —— 数据在库里，重查比背着它走便宜。
 */
function shrinkToolParts(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    if (m.role === 'assistant') {
      return {
        ...m,
        content: m.content.map((p) => {
          if (p.type !== 'tool-call' || p.toolName !== 'savePage') return p;
          const input = p.input as { html?: string } | undefined;
          if (!input?.html) return p;
          return { ...p, input: { ...input, html: `［整页 HTML ${input.html.length} 字，已存进页面，要改先 getPage 取原文］` } };
        }),
      } as ModelMessage;
    }
    if (m.role === 'tool') {
      return {
        ...m,
        content: m.content.map((p) => {
          if (p.type !== 'tool-result') return p;
          const out = p.output;
          if (out.type !== 'json') return p;
          const value = out.value as Record<string, unknown> | null;
          if (p.toolName === 'getPage' && value && typeof value.html === 'string') {
            return { ...p, output: { ...out, value: { ...value, html: `［整页 HTML ${value.html.length} 字，没存进历史］` } } };
          }
          const text = JSON.stringify(out.value);
          if (text.length <= MAX_STORED_RESULT_CHARS) return p;
          return {
            ...p,
            output: {
              type: 'text' as const,
              value: `${text.slice(0, MAX_STORED_RESULT_CHARS)}…［结果共 ${text.length} 字，后面没存进历史，要用就再查一次］`,
            },
          };
        }),
      } as ModelMessage;
    }
    return m;
  });
}

// ── 拼上下文 ────────────────────────────────────────────────────────────────

export type ChatContext = {
  summary: string | null;
  rows: Row[];
  messages: ModelMessage[];
  tokens: number;
};

/**
 * ★ 一切都按对话分开算：上下文只拿这个对话的消息，摘要也是这个对话自己的。
 * 另开一个对话就是一张白纸 —— 长期要记的东西在任务、资料这些表里，不在这。
 */
export async function latestSummary(conversationId: string) {
  return db.chatSummary.findFirst({ where: { conversationId }, orderBy: { createdAt: 'desc' } });
}

/** 「最新摘要 + 摘要之后的原文」。没有摘要时从头算，但最多往回看 FIRST_COMPACT_LOOKBACK */
export async function loadContext(conversationId: string): Promise<ChatContext> {
  const s = await latestSummary(conversationId);
  let since: Date | undefined;
  if (s) {
    const kept = await db.message.findUnique({ where: { id: s.firstKeptId }, select: { createdAt: true } });
    // 保留的那条被删了的话，退回到摘要生成的时刻 —— 摘要本身就涵盖了那之前的
    since = kept?.createdAt ?? s.createdAt;
  }

  let rows = (await db.message.findMany({
    where: { conversationId, ...(since ? { createdAt: { gte: since } } : {}) },
    orderBy: { createdAt: 'asc' },
    select: ROW_SELECT,
  })) as Row[];

  if (!s) {
    // 从新往旧攒，超过回看上限就截掉更早的
    let acc = 0;
    let start = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {
      acc += sum(rowToModelMessages(rows[i]));
      if (acc > FIRST_COMPACT_LOOKBACK) break;
      start = i;
    }
    rows = rows.slice(start);
  }

  const messages = rows.flatMap(rowToModelMessages);
  const summary = s?.summary ?? null;
  return {
    summary,
    rows,
    messages,
    tokens: sum(messages) + (summary ? estimateTextTokens(summary) : 0),
  };
}

/** 摘要怎么接进系统提示 */
export function summaryBlock(summary: string | null): string {
  if (!summary) return '';
  return `

## 之前对话的摘要
更早的对话原文已经不在上下文里了，下面是整理出的摘要。摘要里提到「已存进任务/资料」的，
需要细节时去查（listTasks / searchVault），别凭摘要里的印象回答。

${summary}`;
}

// ── 压缩 ────────────────────────────────────────────────────────────────────

/** pi 的 shouldCompact：上下文 > 预算 − 预留 */
export function shouldCompact(tokens: number): boolean {
  return tokens > CONTEXT_BUDGET - RESERVE_TOKENS;
}

/**
 * pi 的 findCutPoint，简化版：从最新往回累加，攒够 KEEP_RECENT_TOKENS 就停，
 * 然后挪到**那一条或之后最近的一条用户消息**上切。
 *
 * 只在用户开口处切 —— 管家那条的 modelJson 里是工具调用 + 工具结果，
 * 从中间切开，模型会看到一个没有调用方的工具结果，接口直接 400。
 * 最新一轮自己就超过 KEEP_RECENT 的话，就从最新一轮的开头切，前面的全总结掉。
 *
 * 返回保留的第一条的下标；0 表示没东西可压。
 */
function findCutIndex(rows: Row[]): number {
  const userIdx = rows.map((r, i) => (r.role === 'user' ? i : -1)).filter((i) => i > 0);
  if (!userIdx.length) return 0;

  let acc = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    acc += sum(rowToModelMessages(rows[i]));
    if (acc >= KEEP_RECENT_TOKENS) {
      return userIdx.find((u) => u >= i) ?? userIdx[userIdx.length - 1];
    }
  }
  return 0; // 全加起来都没到 KEEP_RECENT，不压
}

/** pi 的 serializeConversation：对话转纯文本，工具结果截断 */
function serialize(rows: Row[]): string {
  const out: string[] = [];
  for (const r of rows) {
    const when = r.createdAt.toISOString().slice(0, 16).replace('T', ' ');
    for (const m of rowToModelMessages(r)) {
      const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content as unknown[]);
      for (const p of parts) {
        const t = (p as { type?: string }).type;
        if (t === 'reasoning') continue;
        let text = partText(p);
        if (!text.trim()) continue;
        if (t === 'tool-result' && text.length > TOOL_RESULT_MAX_CHARS) {
          text = `${text.slice(0, TOOL_RESULT_MAX_CHARS)}…［后面还有 ${text.length - TOOL_RESULT_MAX_CHARS} 字，已截断］`;
        }
        const label =
          t === 'tool-call' ? '管家调用工具' : t === 'tool-result' ? '工具返回' : m.role === 'user' ? '用户' : '管家';
        out.push(`[${when} ${label}]: ${text}`);
      }
    }
  }
  return out.join('\n\n');
}

// 以下三段提示词照 pi 的结构写（SUMMARIZATION_SYSTEM_PROMPT / SUMMARIZATION_PROMPT /
// UPDATE_SUMMARIZATION_INSTRUCTIONS），各节换成家务口径。

const SUMMARY_SYSTEM = `你是对话整理助手。你会读到一段用户和他的家庭管家 AI 之间的对话，
按指定格式写一份结构化摘要。之后管家只能看到这份摘要和最近的对话，看不到这段原文，
所以摘要要让它能无缝接着干活。只输出摘要本身，不要加开场白。`;

const FORMAT = `## 用户在忙的事
[这段对话里用户想办成什么。可以有好几件]

## 偏好与约定
- [用户明确说过的偏好、习惯、要求，比如「报价要书面的」「周末别安排事」]
- [没有就写「（无）」]

## 进展
### 已办完
- [x] [办完的事]
### 进行中
- [ ] [还在跟的事]
### 卡住的
- [在等什么、等谁]

## 做过的决定
- **[决定]**：[理由]

## 接下来
1. [按先后排的下一步]

## 关键信息
- [**金额、日期、电话、人名、地址、单号原样照抄**，一个数字都别改]
- [**用户说过、但还没存进任务或资料库的信息** —— 这是最要紧的，原文一丢就再也找不回来]
- [已经存进平台的，写一句「已存进任务：xxx」或「已存进资料：xxx」即可，不用抄全文]

每一节都写短。**同一条信息只写在最合适的那一节**，别在几节里重复抄 ——
摘要每次压缩都会被续写，重复的东西会越滚越多。`;

const FIRST_PROMPT = `上面是一段要整理的对话。按下面的格式写一份摘要：\n\n${FORMAT}`;

const UPDATE_PROMPT = `上面是**新的**对话内容，<previous-summary> 里是之前的摘要。把新内容合并进去，规则：
- 之前摘要里的信息**全部保留**，除非明确已经不重要了
- 补上新的进展、决定、信息
- 「进行中」里办完的挪到「已办完」
- 按现在的情况更新「接下来」
- 金额、日期、电话、人名原样保留

格式照旧：\n\n${FORMAT}`;

export type CompactResult = { compacted: false } | { compacted: true; tokensBefore: number; tokensAfter: number };

/**
 * 压缩一次：把切点之前的原文（连同上一份摘要）总结成新摘要，存一条 ChatSummary。
 * 下一次 loadContext 就只从切点开始拿原文了。
 */
export async function compact(model: LanguageModel, ctx: ChatContext, conversationId: string): Promise<CompactResult> {
  const cut = findCutIndex(ctx.rows);
  if (cut <= 0) return { compacted: false };

  const toSummarize = ctx.rows.slice(0, cut);
  // 要总结的那段太短就别压：摘要本身有几千字，省下的还不够多调一次模型的钱。
  // 不加这一条，摘要 + 最近原文刚好压在线上时，会变成每轮都压、每次只省几十个 token
  // （测试时把预算调到 3000 就是这样）。
  const gain = toSummarize.reduce((a, r) => a + sum(rowToModelMessages(r)), 0);
  if (gain < KEEP_RECENT_TOKENS / 4) return { compacted: false };
  const convo = `<conversation>\n${serialize(toSummarize)}\n</conversation>`;
  const prompt = ctx.summary
    ? `${convo}\n\n<previous-summary>\n${ctx.summary}\n</previous-summary>\n\n${UPDATE_PROMPT}`
    : `${convo}\n\n${FIRST_PROMPT}`;

  const { text } = await generateText({
    model,
    system: SUMMARY_SYSTEM,
    prompt,
    maxOutputTokens: SUMMARY_MAX_TOKENS,
    // 不带联网搜索的参数：总结不需要上网
  });
  const summary = text.trim();
  // 摘要生成失败就别压 —— 空摘要替换掉原文，等于把记忆清零
  if (!summary) return { compacted: false };

  await db.chatSummary.create({
    data: { summary, firstKeptId: ctx.rows[cut].id, tokensBefore: ctx.tokens, conversationId },
  });

  const kept = ctx.rows.slice(cut).flatMap(rowToModelMessages);
  return { compacted: true, tokensBefore: ctx.tokens, tokensAfter: sum(kept) + estimateTextTokens(summary) };
}

/**
 * 每轮开始前调：需要就压缩，返回这一轮该用的上下文。
 * `incoming` 是这一轮新消息的估算大小 —— 要把它算进去再判断，
 * 否则一张大图 / 一份长 CSV 进来，刚好就越线了。
 */
export async function prepareContext(
  model: LanguageModel,
  incoming: number,
  conversationId: string,
): Promise<ChatContext & { compaction?: CompactResult }> {
  const ctx = await loadContext(conversationId);
  if (!shouldCompact(ctx.tokens + incoming)) return ctx;

  try {
    const r = await compact(model, ctx, conversationId);
    if (!r.compacted) return ctx;
    return { ...(await loadContext(conversationId)), compaction: r };
  } catch (e) {
    // 压缩失败不该让这一轮对话也失败：照旧发全文，下一轮再试
    console.error('[chat] 压缩失败，这一轮照旧发全文', e);
    return ctx;
  }
}
