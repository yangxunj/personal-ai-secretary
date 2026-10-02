import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { buildAgentTools } from '@/lib/agent-tools';
import { intake } from '@/lib/chat-intake';
import { systemPrompt } from '@/lib/system-prompt';
import { getLocale, getT } from '@/lib/i18n/server';
import { db } from '@/lib/db';
import { sessionIsCurrent } from '@/lib/auth';
import { getAiConfig } from '@/lib/ai-config';
import { getOwners } from '@/lib/owners';
import { modelSeesImages, pageBuildOptions, searchOptions } from '@/lib/ai-providers';
import { estimateMessageTokens, prepareContext, summaryBlock, toStoredModelJson } from '@/lib/chat-context';

export const runtime = 'nodejs';
// 对话要连数据库、要写记录，不能被静态化
export const dynamic = 'force-dynamic';
// 推理模型想得久，默认的 10s 不够；写一整页 HTML 要几分钟
export const maxDuration = 600;

// ⚠ **provider 必须在请求里创建，不能提到模块顶层。**
//
// 提到顶层的话它只在第一次 import 时读一遍配置，使用者在设置页换了 key
// 也得重启服务才生效 —— 而桌面端装在别人电脑上，"重启服务"这件事根本没法
// 要求他做。现在每次请求从数据库取（库里没有才回落到 .env）。
//
// 代价只是每轮对话多一次 Setting 表的查询，本地 SQLite 上不值一提。

// 系统提示在 lib/system-prompt.ts；收附件、把附件整理成模型能吃的样子在 lib/chat-intake.ts

/**
 * 对话 id 只认两种格式，免得有人拿请求体往库里塞奇怪的主键：
 * 页面生成的（cuid / 去掉横线的 UUID），和迁移时建的那个 'legacy'（以前的对话）
 */
const CONVERSATION_ID = /^(legacy|[a-z0-9]{20,40})$/;

async function resolveConversation(id: string | undefined): Promise<string | null> {
  if (id === undefined) {
    const latest = await db.conversation.findFirst({ orderBy: { updatedAt: 'desc' }, select: { id: true } });
    if (latest) return latest.id;
    return (await db.conversation.create({ data: {} })).id;
  }
  if (!CONVERSATION_ID.test(id)) return null;
  await db.conversation.upsert({ where: { id }, create: { id }, update: {} });
  return id;
}

export async function POST(req: Request) {
  // 在请求一开始就取好：onFinish 在流结束后才跑，别指望那时还能读 headers()
  // （没设过语言时 getLocale 要看 Accept-Language）
  const t = await getT();
  const locale = await getLocale();

  // middleware 已经验过签名和过期，但它在 Edge runtime 上，验不了密码版本。
  // 不补这一句，改完密码以后旧 cookie 页面进不去、直接打这个接口却还能跟 AI 对话。
  if (!(await sessionIsCurrent())) {
    return new Response(t('未授权'), { status: 401 });
  }

  const cfg = await getAiConfig();
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    // 说清楚该去哪儿修。不说的话前端只能弹一句「模型调用出错」，
    // 而使用者刚装完软件、还没填 key，最需要的恰恰是这句指路。
    return new Response(t('还没设置模型。打开「设置」（宽屏在侧栏左下角），填好 API Key 再回来。'), {
      status: 503,
    });
  }
  const provider = createOpenAICompatible({
    name: 'ai',
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
  });

  // 前端只发这一轮的新消息（见 Chat.tsx 的 prepareSendMessagesRequest）。
  // 历史从数据库拼 —— 以前用的是前端内存里的，刷新一下模型就什么都不记得了。
  // 旧版前端（桌面端没更新时）还会发整串 messages，取最后一条就行。
  const body = (await req.json()) as { message?: UIMessage; messages?: UIMessage[]; conversationId?: string };
  const newest = body.message ?? body.messages?.at(-1);
  if (!newest) return new Response(t('没有消息'), { status: 400 });
  const messages = [newest];

  // 哪个对话。新对话的 id 是页面上先生成好的（见 chat/[[...id]]/page.tsx），
  // 第一句话发过来时才真正建出来 —— 点了「新对话」又没说话，不留一个空壳在列表里。
  // 旧版前端（没更新的桌面端）不传，就接着用最近的那个对话。
  const conversationId = await resolveConversation(body.conversationId);
  if (!conversationId) return new Response(t('对话 id 不对'), { status: 400 });

  const { incoming, clean } = await intake(messages, modelSeesImages(cfg));

  // v7 的 convertToModelMessages 返回 Promise（要处理 file part 之类的异步转换）
  const newMessages = await convertToModelMessages(clean);
  const chatModel = provider.chatModel(cfg.model);

  // 需要就先压缩（见 lib/chat-context.ts）。压缩要多调一次模型，这一轮会慢几秒
  const ctx = await prepareContext(
    chatModel,
    newMessages.reduce((a, m) => a + estimateMessageTokens(m), 0),
    conversationId,
  );
  console.log(`[chat] context ~${ctx.tokens} tokens (${ctx.rows.length} messages${ctx.summary ? ' + summary' : ''})`);
  if (ctx.compaction?.compacted) {
    console.log(`[chat] context compacted: ~${ctx.compaction.tokensBefore} → ${ctx.compaction.tokensAfter} tokens`);
  }
  const modelMessages = [...ctx.messages, ...newMessages];

  // 百炼上是一个请求参数（enable_search），模型自己决定这一轮要不要搜
  const search = searchOptions(cfg);

  const result = streamText({
    model: chatModel,
    system: systemPrompt(!!search, await getOwners(), locale) + summaryBlock(ctx.summary),
    messages: modelMessages,
    // 页面由同一个模型另起一次调用来写，推理拉满（见 lib/page-builder.ts）
    tools: buildAgentTools({ incoming, conversationId, t, pageBuilder: { model: chatModel, locale, ...pageBuildOptions(cfg) } }),
    // 允许「调工具 → 看结果 → 再调 → 最后作答」。不给它多步，
    // 模型调完一个工具就停住了，用户只看到一个工具卡片没有回复。
    stopWhen: stepCountIs(8),
    // 键名要跟上面 createOpenAICompatible 的 name 一致，SDK 按它把参数并进请求体
    ...(search ? { providerOptions: { ai: search as Record<string, never> } } : {}),
    // 推理模型先想再说：给小了会把 token 全花在思考上，正文是空的。
    // （以前一整页 HTML 是工具参数、也算在这里面；现在页面另起调用写了，
    // 但 brief 和 data 有时也不短，留着这个余量。）
    maxOutputTokens: 32768,

    async onFinish({ text, responseMessages }) {
      // 对话本身就是平台的「记录」，也是下一轮的上下文 —— 不落库就等于没说过。
      const lastUser = newest.role === 'user' ? newest : undefined;
      const userText = lastUser?.parts
        ?.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
        .trim();

      try {
        const msg =
          userText || incoming.length
            ? await db.message.create({
                data: {
                  role: 'user',
                  // 这两句会显示在对话记录里，所以按当时的界面语言写
                  content: userText || t('［上传了 {n} 个文件］', { n: incoming.length }),
                  status: 'handled',
                  conversationId,
                },
              })
            : null;

        // 没被任何工具认领的文件挂到这条消息上。
        // 不挂就成了 uploads/ 里的孤儿：磁盘上有、平台上看不见、备份打走了也没人知道是什么。
        if (msg && incoming.length) {
          const claimed = await db.attachment.findMany({
            where: { storedPath: { in: incoming.map((f) => f.storedPath) } },
            select: { storedPath: true },
          });
          const taken = new Set(claimed.map((a) => a.storedPath));
          const orphans = incoming.filter((f) => !taken.has(f.storedPath));
          if (orphans.length) {
            await db.attachment.createMany({
              data: orphans.map((f) => ({ ...f, messageId: msg.id, uploadedBy: 'user' })),
            });
          }
        }

        // 模型这一轮的完整往来（工具调用、结果、回复）存进 modelJson，
        // 下一轮拼上下文时用它 —— 光存 text 的话，模型下一轮就不知道刚才建的任务 id。
        // 只调了工具、最后没说话的一轮也要存，否则那次工具调用就从记忆里消失了。
        // ⚠ 用 responseMessages，不是 response.messages：v7 里后者只是**最后一步**的，
        // 调了两次工具再作答的一轮，存下来就只剩最后那句话（实测踩过）。
        const modelJson = toStoredModelJson(responseMessages);
        if (text?.trim() || modelJson) {
          await db.message.create({
            data: {
              role: 'secretary',
              content: text.trim() || t('（已处理）'),
              status: 'read',
              modelJson,
              conversationId,
            },
          });
        }
        // 列表按最后说话的时间排
        await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      } catch (e) {
        // 存不进去也不该把已经流给用户的回复搞没了
        console.error('[chat] failed to save messages', e);
      }
    },
  });

  return result.toUIMessageStreamResponse({
    // DeepSeek 的思考过程走 reasoning_content，前端要单独渲染，
    // 不送过去的话「它在想什么」就完全看不见了
    sendReasoning: true,
    onError: (e) => {
      console.error('[chat] stream error', e);
      return e instanceof Error ? e.message : t('模型调用出错');
    },
  });
}
