import { streamText, type LanguageModel } from 'ai';
import { pageDesignGuide, type PageType } from '@/lib/page-design';

/**
 * 写页面的那一次**单独的**模型调用。
 *
 * 为什么不让对话里的模型直接把 HTML 当工具参数写出来（原来的 savePage 就是这样）：
 *   1. 推理强度：对话按默认强度跑就够了，写页面要拉满（见 ai-providers.ts 的 pageBuildOptions）——
 *      同一个模型，拉满之后版式、动效、玩法明显更用心。两件事放在一次调用里没法分开设。
 *   2. 设计规范只进这一次调用的系统提示词，平时聊天不用背着它，也不用靠「先调一个工具读规范」
 *      这种闸门逼模型去读（以前的 pageDesignGuide 就是干这个的）。
 *   3. 上下文干净：只有需求、数据、旧页面，没有前面几十轮的闲聊和工具结果。
 *
 * 对话里的模型负责把需求写清楚（brief）、把要用的真实数据查好带过来（data）；
 * 它看得到图片、聊过天、知道用户是谁，这里都不知道。
 *
 * 给模型看的文字保持中文（见 docs/开发笔记.md 的多语言一节）。
 */

export type PageBuilder = {
  model: LanguageModel;
  providerOptions?: { ai: { reasoningEffort: string } };
  maxOutputTokens: number;
  /** 界面语言。页面上的文字跟着它 */
  locale?: string;
};

export type BuildProgress = {
  phase: 'thinking' | 'writing';
  /** 思考了多少字、写了多少字 HTML */
  thinking: number;
  written: number;
  seconds: number;
};

const RULES = `
你是一个前端工程师兼视觉设计师。按下面的需求写**一个完整、独立的单文件 HTML 页面**。

## 输出格式
只输出 HTML 本身：从 <!doctype html> 开始，到 </html> 结束。
前后不要任何解释，不要用 \`\`\` 代码块包起来。

## 硬限制（页面跑在沙箱里，不是建议）
- **不能联网**：CDN 上的库、网络字体、外链图片一律加载不出来，fetch / XHR 也发不出去。
  图表用内联 <svg> 或 <canvas> 自己画；字体用 system-ui。
- **数据只用需求里给的**。需求里给了真实数据就原样写进页面；没给的数字**绝不编**，
  在页面上写「暂无数据」。数据快照类页面在显眼处写「数据截至 YYYY-MM-DD」，日期用需求里给的。
- alert() 能用（显示成不阻塞的提示条）；confirm() / prompt() 不行，要确认或输入就自己画按钮和 <input>。
- localStorage 只在这次打开期间有效，关掉就没了。要长期记住东西用下面的 pageStore。

## 长期存数据：window.pageStore
平台给每个页面一块自己的存储，关掉再开、换手机打开都还在。API（都返回 Promise）：
\`\`\`
await pageStore.get(key)          // 没存过 → null
await pageStore.set(key, value)   // value 是任意能 JSON 的值；整份覆盖
await pageStore.remove(key)
await pageStore.keys()            // → ['books', ...]
pageStore.persistent              // false = 临时预览（存了关掉会丢），可以在角落小字提示
\`\`\`
- 页面要「记东西」（读书记录、打卡、清单、记账、收藏、最高分），就用它；纯展示的报告不用。
- 打开时先 \`await pageStore.get(...)\` 读出来再渲染，读的时候显示「加载中」，读完是空的要有空状态。
- 一类东西放一个 key，值用数组：例如 \`"books"\` → \`[{ id, title, author, finishedAt, rating, note, createdAt }]\`。
  每条带 id（\`Date.now().toString(36)\` 之类）和日期字段（YYYY-MM-DD）。
- **每次改动立刻 set 整个数组**，不要攒着等「保存」按钮；set 失败（catch）要提示「没存上」。
- key 用英文小写加下划线，**起好了就不要改**：AI 助手以后会按这个 key 读数据回答用户的问题（「今年读了几本」），
  也可能在对话里替用户往里加条目 —— 所以页面每次打开都要重新读，不要假设数据只有页面自己写。
- 删除要有撤销或二次确认（自己画），误删的数据找不回来。
- 数据存在平台上，不在浏览器里：**别在页面上写「数据只存在这台设备上」**这类话，换手机打开一样看得到。
- **用了 pageStore 就必须在 <head> 里声明数据格式**，AI 助手靠它知道往哪个 key 写、每条长什么样
  （页面还没存数据时，它没别的办法知道）：
\`\`\`
<script type="application/json" id="pagestore-schema">
{ "books": { "desc": "读过的书，一本一条", "example": [{ "id": "lq3x9a", "title": "三体", "author": "刘慈欣", "date": "2026-03-01", "rating": 5, "note": "一句话感想" }] } }
</script>
\`\`\`
  example 里的字段名、类型、日期格式必须跟页面代码里读写的完全一致；可选字段也写上。

## 手机优先
- 必须有 <meta name="viewport" content="width=device-width, initial-scale=1">
- 宽度用 max-width:100% / 百分比，别写死几百像素宽，375px 宽下不能横向滚动
- 一根手指能用全：别只绑 keydown（手机没有键盘），游戏要画方向键或支持滑动，点击目标至少 44px
- 游戏结束要能「再来一局」

## 深浅两套颜色
用 CSS 变量 + @media (prefers-color-scheme: dark) 写两套，平台切深色时页面跟着变。
`;

function systemPrompt(type: PageType, locale?: string) {
  const lang =
    locale === 'en' ? '\n## 页面语言\n用户用的是英文界面：**页面上所有文字都用英文写**（需求是中文也一样）。\n' : '';
  return RULES + lang + '\n' + pageDesignGuide(type);
}

function userPrompt(p: {
  title: string;
  brief: string;
  data?: string;
  existing?: string;
  stored?: { key: string; sample: string }[];
  today: string;
}) {
  const parts = [`# 页面：${p.title}\n\n今天是 ${p.today}。\n\n# 需求\n${p.brief}`];
  if (p.data?.trim()) parts.push(`# 要写进页面的真实数据\n${p.data}`);
  if (p.existing) {
    parts.push(
      '# 现在的页面\n在它的基础上改：需求里没让动的地方保持原样（玩法、配色、文案都别顺手改掉）。\n\n' + p.existing,
    );
  }
  if (p.stored?.length) {
    parts.push(
      '# 这个页面里已经存着的数据（pageStore）\n用户已经在里面记了东西。新页面**必须能读出这些 key、按这个格式**，' +
        '加字段可以，改名、改结构不行 —— 不然用户记过的东西就全看不见了。\n' +
        p.stored.map((s) => `- \`${s.key}\`：${s.sample}`).join('\n'),
    );
  }
  return parts.join('\n\n');
}

/** 从模型输出里抠出 HTML：容忍它前后多说两句、或者包了代码块 */
export function extractHtml(text: string): string | null {
  const start = text.search(/<!doctype html|<html[\s>]/i);
  const end = text.toLowerCase().lastIndexOf('</html>');
  if (start < 0 || end < start) return null;
  return text.slice(start, end + '</html>'.length);
}

/**
 * 写一页。边写边吐进度（每秒左右一次），最后 return HTML 或错误。
 * 对话那边的工具卡片靠这些进度显示「正在思考 / 已写 xx 字」，不然一两分钟没动静像是卡死了。
 */
export async function* buildPageHtml(
  b: PageBuilder,
  p: {
    type: PageType;
    title: string;
    brief: string;
    data?: string;
    existing?: string;
    stored?: { key: string; sample: string }[];
    abortSignal?: AbortSignal;
  },
): AsyncGenerator<BuildProgress, { ok: true; html: string } | { ok: false; error: string }> {
  const started = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const result = streamText({
    model: b.model,
    system: systemPrompt(p.type, b.locale),
    prompt: userPrompt({ ...p, today }),
    maxOutputTokens: b.maxOutputTokens,
    ...(b.providerOptions ? { providerOptions: b.providerOptions } : {}),
    abortSignal: p.abortSignal,
  });

  let thinking = 0;
  let text = '';
  let last = 0;
  for await (const part of result.fullStream) {
    if (part.type === 'reasoning-delta') thinking += part.text.length;
    else if (part.type === 'text-delta') text += part.text;
    else if (part.type === 'error') {
      const e = part.error;
      return { ok: false, error: `写页面的模型调用出错：${e instanceof Error ? e.message : String(e)}` };
    } else if (part.type === 'abort') {
      return { ok: false, error: '已中止' };
    }
    const now = Date.now();
    if (now - last > 1000) {
      last = now;
      yield {
        phase: text ? 'writing' : 'thinking',
        thinking,
        written: text.length,
        seconds: Math.round((now - started) / 1000),
      };
    }
  }

  const reason = await result.finishReason;
  const usage = await result.usage;
  console.log(
    `[page-builder] ${p.type} "${p.title}" ${Math.round((Date.now() - started) / 1000)}s, ` +
      `reasoning ${usage.outputTokenDetails?.reasoningTokens ?? '?'} / output ${usage.outputTokens ?? '?'} tokens, finish=${reason}`,
  );
  const html = extractHtml(text);
  if (!html) {
    return {
      ok: false,
      error:
        reason === 'length'
          ? '页面太长，写到一半被截断了。把需求收窄一点（少放几屏、明细只放前几十条）再试。'
          : '写页面的模型没有给出完整的 HTML。',
    };
  }
  return { ok: true, html };
}
