import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { buildAgentTools } from '@/lib/agent-tools';
import { storeUpload, decodeDataUrl, type StoredFile } from '@/lib/ingest';
import { docKind, extractDoc } from '@/lib/doc-extract';
import { isModelImage, isTextFile, unreadableReason } from '@/lib/file-support';
import { db } from '@/lib/db';
import { sessionIsCurrent } from '@/lib/auth';
import { getAiConfig } from '@/lib/ai-config';
import { getOwners } from '@/lib/owners';
import { modelSeesImages, searchOptions } from '@/lib/ai-providers';
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

/**
 * 系统提示。
 *
 * 三件事必须写死在这儿，别指望模型自己想明白：
 *
 * 1. **今天几号**。模型不知道当前日期，而这个秘书干的活大半跟日期有关
 *    （「下周三」「月底前」）。不给它，它会把 dueDate 算到去年。
 * 2. **什么时候该建任务、什么时候只是聊天**。不说清楚，它会把「今天天气真好」
 *    也存成一条待办。
 * 3. **中文**。
 */
function systemPrompt(canSearch: boolean, owners: string[]) {
  const today = new Date();
  // 本地日期，不是 UTC：北京时间早上 8 点前 toISOString 给的还是昨天，
  // 「明天」就会被算成今天
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()];
  return `你是主人的私人生活秘书，帮他打理待办、资料、财务、健康这些家务事。

今天是 ${iso}（${weekday}）。用户说「下周三」「月底前」这类相对时间时，按这个日期算成具体日期再填进工具。

用中文回答，说话简短自然，像个熟悉他情况的助理，不要用「作为AI助手」这类客套话。

什么时候动手、什么时候只是聊：
- 用户说「记一下」「别忘了」「要去办…」这类以后要跟进的事 → createTask
- 用户问「还有什么没做」「那件事怎么样了」→ 先 listTasks 再回答，不要凭空说
- 用户说「记住我的账号是…」「以后要查」→ addVaultItem
- 用户问「我的卡号多少」「WiFi 密码」→ searchVault，查到了就直接把值告诉他
- 用户问钱、体检指标、保单的具体数字 → 先 queryFinance / queryHealth / queryPolicies 查，**绝不凭印象报数**
- 普通聊天、问知识、闲谈 → 直接回答，**不要调任何工具**

做页面：用户说「做个页面 / 图表 / 报告 / 看板」「做个小游戏 / 小工具」→ savePage，存进「页面」栏目。
- 要数据的，先用上面的查询工具拿到真实数据再写，没数据就在页面上写明，**绝不编**
- 要改已有页面：listPages 找 id → getPage 取回原文 → 在原文基础上改 → savePage 带上 id
- 写完在回复里附上链接 [打开页面](/pages/<id>)，一两句说清页面上有什么，**别把 HTML 贴进回复**
${
  canSearch
    ? `- 天气、新闻、价格、政策、营业时间这类会变的事 → 你能联网搜索，查了再答，
  末尾附上来源网址。**别把用户的私人信息（账号、证件号、家人病情）写进搜索词**`
    : ''
}

用户传图片上来时：
- 银行账单 / 流水截图 → 你自己把每一笔读出来，调 importBill。**看到期初、期末
  余额一定要填进去**，那是唯一能自动验出「你有没有读错」的东西。
  看不清的笔数写进 warnings，**绝不要编一个数字填上去**。
- 体检报告 / 检验单 → 你自己把指标一项项读出来，调 importHealthReport。
  正常的也要录，趋势要靠它。
- 别的（合同、证件、说明书、随手拍）→ saveFile 归档，顺手用一句话说清这是什么。
- 只是让你看一眼、问「这是什么」→ 直接回答，别入库。

存资料时注意标敏感：银行卡号、证件号、社保号这类整条标 sensitive；
密码、PIN、验证码这类字段单独标 secret。标了页面上才会打码，
不标就是明晃晃摊在手机屏幕上。

要改或要完成某条待办时，**先 listTasks 拿到真实 id**，绝不凭印象编 id。

家里的人（任务负责人从这里选）：${owners.join('、')}。第一个是用户本人。
用户说「这件事交给 X」「让 X 去办」就把 owner 填成 X；X 不在名单里就照写，
并提醒一句可以去「设置 → 家里的人」把他加进去。没说是谁的事就别填，留给用户自己派。

调完工具后用一句话告诉用户你做了什么（比如「记下了，9 月 30 号到期」），
不要把工具返回的 JSON 原样念出来。工具返回里有 warnings 的，**必须原样转告** ——
读错了的账单和读对了的账单在页面上长得一模一样，不说用户就不知道该回查。`;
}

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
async function intake(
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
  // middleware 已经验过签名和过期，但它在 Edge runtime 上，验不了密码版本。
  // 不补这一句，改完密码以后旧 cookie 页面进不去、直接打这个接口却还能跟 AI 对话。
  if (!(await sessionIsCurrent())) {
    return new Response('未授权', { status: 401 });
  }

  const cfg = await getAiConfig();
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    // 说清楚该去哪儿修。不说的话前端只能弹一句「模型调用出错」，
    // 而使用者刚装完软件、还没填 key，最需要的恰恰是这句指路。
    return new Response('还没设置模型。打开「设置」（宽屏在侧栏左下角），填好 API Key 再回来。', {
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
  if (!newest) return new Response('没有消息', { status: 400 });
  const messages = [newest];

  // 哪个对话。新对话的 id 是页面上先生成好的（见 chat/[[...id]]/page.tsx），
  // 第一句话发过来时才真正建出来 —— 点了「新对话」又没说话，不留一个空壳在列表里。
  // 旧版前端（没更新的桌面端）不传，就接着用最近的那个对话。
  const conversationId = await resolveConversation(body.conversationId);
  if (!conversationId) return new Response('对话 id 不对', { status: 400 });

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
  console.log(`[chat] 上下文约 ${ctx.tokens} token（${ctx.rows.length} 条原文${ctx.summary ? ' + 摘要' : ''}）`);
  if (ctx.compaction?.compacted) {
    console.log(`[chat] 上下文压缩：约 ${ctx.compaction.tokensBefore} → ${ctx.compaction.tokensAfter} token`);
  }
  const modelMessages = [...ctx.messages, ...newMessages];

  // 百炼上是一个请求参数（enable_search），模型自己决定这一轮要不要搜
  const search = searchOptions(cfg);

  const result = streamText({
    model: chatModel,
    system: systemPrompt(!!search, await getOwners()) + summaryBlock(ctx.summary),
    messages: modelMessages,
    tools: buildAgentTools({ incoming, conversationId }),
    // 允许「调工具 → 看结果 → 再调 → 最后作答」。不给它多步，
    // 模型调完一个工具就停住了，用户只看到一个工具卡片没有回复。
    stopWhen: stepCountIs(8),
    // 键名要跟上面 createOpenAICompatible 的 name 一致，SDK 按它把参数并进请求体
    ...(search ? { providerOptions: { ai: search as Record<string, never> } } : {}),
    // 推理模型先想再说：给小了会把 token 全花在思考上，正文是空的。
    // 做页面时一整页 HTML 是一次工具调用的参数，也算在这里面 —— 原来的 4096
    // 连一个带图表的页面都写不完，JSON 被截断，工具直接报参数错误。
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
                  content: userText || `［上传了 ${incoming.length} 个文件］`,
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
              content: text.trim() || '（已处理）',
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
        console.error('[chat] 记录写入失败', e);
      }
    },
  });

  return result.toUIMessageStreamResponse({
    // DeepSeek 的思考过程走 reasoning_content，前端要单独渲染，
    // 不送过去的话「它在想什么」就完全看不见了
    sendReasoning: true,
    onError: (e) => {
      console.error('[chat] 流式出错', e);
      return e instanceof Error ? e.message : '模型调用出错';
    },
  });
}
