#!/usr/bin/env node
/**
 * AI 配置自检：端点通不通、模型名对不对、能不能看图。
 *
 *   node scripts/check-ai.mjs
 *
 * 为什么要有它：DashScope / 百炼那边的 base_url 和模型 ID 说法不一 ——
 * 经典的 dashscope.aliyuncs.com 和新的 {workspace}.maas.aliyuncs.com 都在用，
 * 模型 ID 有 deepseek-flash / deepseek-v4.1-flash / 带 workspace 前缀几种写法，
 * 文档还互相打架。**与其照文档猜，不如直接问服务器要一份可用清单。**
 *
 * 三步，每步失败都直接说清楚下一步该干什么：
 *   1. GET /models      —— 端点和 key 对不对，顺便列出所有能用的模型
 *   2. 一次最小对话      —— 配的那个模型名真能调通
 *   3. 一张 1×1 的图片   —— 这个模型到底能不能看图（账单和体检报告全靠它）
 *
 * ⚠ 「HTTP 200」不等于「通了」。deepseek-v4.1-flash 是推理模型，会先花
 *   token 思考再产出正文；max_tokens 给小了，全部 token 用在 reasoning 上，
 *   接口照样 200，但 content 是空字符串。第一版脚本就这么把空回复报成了
 *   ✓ 通过 —— **正文为空必须算失败**，否则自检等于没做。
 */
import { readFileSync } from 'node:fs';

try {
  process.loadEnvFile();
} catch {
  console.error('读不到 .env —— 先 cp .env.example .env');
  process.exit(1);
}

const BASE = (process.env.AI_BASE_URL ?? '').replace(/\/+$/, '');
const KEY = process.env.AI_API_KEY ?? '';
const MODEL = process.env.AI_MODEL ?? '';

if (!BASE || !KEY || !MODEL) {
  console.error('缺配置：');
  if (!BASE) console.error('  AI_BASE_URL 没填');
  if (!KEY) console.error('  AI_API_KEY 没填');
  if (!MODEL) console.error('  AI_MODEL 没填');
  process.exit(1);
}

const auth = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const mask = `${KEY.slice(0, 6)}…${KEY.slice(-4)}`;
console.log(`端点 ${BASE}`);
console.log(`模型 ${MODEL}`);
console.log(`key  ${mask}（${KEY.length} 字符）\n`);

let failed = false;

// ---------- 1. 列模型 ----------
console.log('[1/3] 列出可用模型…');
let names = [];
try {
  const r = await fetch(`${BASE}/models`, { headers: auth });
  if (!r.ok) {
    console.log(`  ✗ HTTP ${r.status} —— ${(await r.text()).slice(0, 200)}`);
    console.log('  端点或 key 不对。401/403 = key 的问题，404 = base_url 的问题。');
    failed = true;
  } else {
    const j = await r.json();
    names = (j.data ?? []).map((m) => m.id);
    const ds = names.filter((n) => /deepseek/i.test(n));
    console.log(`  ✓ 共 ${names.length} 个模型，其中 deepseek 系列 ${ds.length} 个：`);
    for (const n of ds.slice(0, 15)) console.log(`      ${n}${n === MODEL ? '   ← 当前配置' : ''}`);
    if (ds.length && !names.includes(MODEL)) {
      console.log(`  ⚠ 配置的 "${MODEL}" 不在清单里 —— 从上面挑一个填进 .env 的 AI_MODEL`);
    }
  }
} catch (e) {
  console.log(`  ✗ 连不上：${e.message}`);
  console.log('  境内机器连 api.deepseek.com 是通的；连 Anthropic 才不通。检查 base_url 拼写。');
  failed = true;
}

// ---------- 2. 最小对话 ----------
console.log('\n[2/3] 发一句话试试…');
try {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: '只回复两个字：收到' }],
      // 推理模型要先想再说，给小了就只剩思考没有正文
      max_tokens: 512,
    }),
  });
  const body = await r.text();
  if (!r.ok) {
    console.log(`  ✗ HTTP ${r.status} —— ${body.slice(0, 300)}`);
    failed = true;
  } else {
    const j = JSON.parse(body);
    const msg = j.choices?.[0]?.message ?? {};
    const text = (msg.content ?? '').trim();
    const reasoning = (msg.reasoning_content ?? '').trim();
    const u = j.usage ?? {};
    if (!text) {
      console.log('  ✗ HTTP 200 但正文是空的');
      if (reasoning) console.log(`    思考了 ${reasoning.length} 字，但没产出正文`);
      console.log(`    用量 ${JSON.stringify(u)}`);
      console.log('    这是推理模型 —— max_tokens 要留够思考的量，否则永远拿不到答案。');
      console.log(`    结束原因 finish_reason=${j.choices?.[0]?.finish_reason}`);
      failed = true;
    } else {
      console.log(`  ✓ 回复：${text}`);
      if (reasoning) console.log(`    （另有 ${reasoning.length} 字思考过程，走 reasoning_content 字段）`);
      console.log(`    用量 ${JSON.stringify(u)}`);
    }
  }
} catch (e) {
  console.log(`  ✗ ${e.message}`);
  failed = true;
}

// ---------- 3. 看图 ----------
// 账单和体检报告这两个模块全押在视觉上，所以这一步失败 = 得换模型，
// 不是「以后再说」的小事。用一张 1×1 的红点，不依赖任何外部文件。
console.log('\n[3/3] 试试看图…');
const DOT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
try {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '这张图是什么颜色？只答颜色。' },
            { type: 'image_url', image_url: { url: DOT } },
          ],
        },
      ],
      max_tokens: 512,
    }),
  });
  const body = await r.text();
  if (!r.ok) {
    console.log(`  ✗ HTTP ${r.status} —— ${body.slice(0, 300)}`);
    console.log('  这个模型多半不支持图片输入。账单和体检报告要靠它读图，');
    console.log('  所以得换一个带视觉的型号，或者这两块改成手工录入。');
    failed = true;
  } else {
    const j = JSON.parse(body);
    const text = (j.choices?.[0]?.message?.content ?? '').trim();
    if (!text) {
      console.log('  ✗ HTTP 200 但正文是空的 —— 不能算「能看图」');
      console.log(`    用量 ${JSON.stringify(j.usage ?? {})}`);
      failed = true;
    } else {
      console.log(`  ✓ 能看图，回复：${text}`);
    }
  }
} catch (e) {
  console.log(`  ✗ ${e.message}`);
  failed = true;
}

console.log(failed ? '\n有步骤没过，按上面的提示改 .env 再跑一次。' : '\n三步都过了，可以开始接 /chat 了。');
process.exitCode = failed ? 1 : 0;
