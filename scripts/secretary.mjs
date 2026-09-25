#!/usr/bin/env node
/**
 * 管家 CLI —— 供 Claude Code 侧读写平台数据
 * 用法: node scripts/secretary.mjs <命令> [参数]
 * 运行 `node scripts/secretary.mjs help` 查看全部命令
 */
import { PrismaClient } from '@prisma/client';
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { healthCommands } from './health-commands.mjs';
import { policyCommands } from './policy-commands.mjs';

// 显式加载 .env。不要依赖 Prisma 顺手加载的副作用 —— 动态 import Prisma 的
// 脚本会在读取环境变量时拿到 undefined，排查起来很费劲。
try {
  process.loadEnvFile();
} catch {
  // 没有 .env 就用系统环境变量
}


const db = new PrismaClient();
const execFileAsync = promisify(execFile);
const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = [];
let flags = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  } else positional.push(a);
}

/**
 * 记下哪些 flag 被真正读过。
 *
 * 起因：`task:new --note "..."` —— 任务的字段叫 `detail`，`--note` 是资料和
 * 文件那边的写法。参数被**静默丢掉**，任务建出来了、说明没了，等两小时后
 * 截图才发现。写错一个词就丢数据，而且当场毫无提示。
 *
 * 所以用 Proxy 记录访问过的 key，命令跑完对一遍，没被读过的就喊一声。
 * 不报错、不中断 —— 只是提醒，因为确实存在「某些分支才读」的情况。
 */
const usedFlags = new Set();
const rawFlags = flags;
flags = new Proxy(rawFlags, {
  get(t, k) {
    if (typeof k === 'string') usedFlags.add(k);
    return t[k];
  },
});

/** 收集重复出现的 --field 参数 */
function repeated(name) {
  // 这里绕过 flags 直接翻 argv，所以要手工报一声「这个参数我读了」——
  // 否则下面那个「参数没读」的警告会在每次 vault:add 时误报，喊几次狼来了
  // 就没人再看它了。
  usedFlags.add(name);
  return argv.filter((a, i) => argv[i - 1] === `--${name}` && !a.startsWith('--'));
}

const j = (o) => JSON.stringify(o, null, 2);
/**
 * 分 → 「¥ 1,234.56」。金额一律用整数分存，只在打印时才变成小数。
 * 符号跟页面那边共用同一个环境变量，别让 CLI 和网页显示成两种货币。
 */
const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY_SYMBOL ?? '¥';
const BASE_CURRENCY = process.env.NEXT_PUBLIC_BASE_CURRENCY ?? 'CNY';
const money = (cents) => (cents == null ? '—' : `${CURRENCY} ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * 交易金额加总一律走这个，**不要直接加 amountCents**。
 *
 * 页面那边有 `src/lib/finance.ts` 的 base()，CLI 这边原先没有对应的东西 ——
 * 于是一笔 USD 2,500（折合 ¥18,000）在 bills / bill:show 里显示成 ¥2,500，
 * 少算七倍，而且看不出任何异常。两端的口径必须一致。
 */
const baseOf = (t) => t.baseCents ?? t.amountCents;
/**
 * 「真实支出」要排除的分类。**必须跟 `src/lib/finance.ts` 的 `SPEND_EXCLUDED`
 * 一模一样** —— 网页和 CLI 对同一个月说出两个「真实支出」，比说错一个数字
 * 更难发现：两边都言之凿凿，你不会想到去对。
 *
 * 这里原来只排 balance 和 self_transfer，漏了 pass_through（过手不属于自己的钱）
 * 和 uncategorized（原文不够判断用途的，还没定性就不该计进支出）。
 */
const SPEND_EXCLUDED = ['self_transfer', 'balance', 'pass_through', 'uncategorized'];
const line = () => console.log('─'.repeat(52));
const abs = (stored) => path.resolve(UPLOAD_DIR, stored);

// ---------- 命令 ----------
/**
 * 不挂任务的消息要落在某个对话里，对话页才看得见（对话页按对话分开显示）。
 * 用 --conversation <id> 指定；不指定就接在最近说过话的那个对话后面，一个都没有就建一个。
 */
async function chatConversation() {
  if (flags.conversation) return String(flags.conversation);
  const latest = await db.conversation.findFirst({ orderBy: { updatedAt: 'desc' }, select: { id: true } });
  const id = latest?.id ?? (await db.conversation.create({ data: {} })).id;
  await db.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
  return id;
}

const commands = {
  async help() {
    console.log(`
管家 CLI

  记录（平台是结果呈现层，沟通在 Claude Code 里进行，由我写入留档）
    log --user "主人说的话" --reply "我的回复"   记录一轮沟通，两个参数都可单用
        --task <id>             关联到某个任务
        --topic <id>            关联到某个专题（专题页会聚过来）
        --file <路径>            给回复附带一个文件（会复制进 data/uploads）
    reply "内容"                 只记我的回复（等同 log --reply）
        --task <id>  --file <路径>
    timeline [--limit 20]       回看最近的记录

  收件箱（网页目前没有发消息入口，暂时用不到）
    inbox / inbox --all         列出待处理 / 全部消息
    handled <msgId>… | --all    标记为已处理

  任务
    tasks [--status todo|doing|blocked|done|cancelled] [--category 教育] [--owner 代办人|none]
    task:new "标题" [--detail ...] [--category 财务] [--priority 1|2|3] [--due 2026-09-01]
        --topic <id>            挂到某个专题下，专题页会把它聚过来
        --owner 代办人             谁去办。不写 = 未指派，页面上单独一格筛得出来
        --doc <文稿id>           挂一份文稿（操作指引/话术/任务书），任务卡片上出现可点的链接
        --after <任务id>         前置任务：这件事要等它做完。软提示不硬挡，前置一完成自动放行
    reply "回复内容" --task <任务id>   回进任务的留言板，页面上她看得见
    task:update <id> [--status doing] [--result "处理结果"] [--title ...] [--detail ...]
        [--category ...] [--priority 1|2|3] [--due ...] [--topic <id>|none] [--owner ...|none] [--doc <id>|none] [--after <id>|none]
    task:show <id>

  账单（**没有解析器** —— 我读账单原件自己写 JSON，不挑银行）
    finance:import <账单.json> [--attach <原件>…]
        我读图/读 PDF 写出 JSON，这个命令入库。JSON 形状见代码注释。
        入库时做余额勾稽：期初 + 进账 − 出账 对不上期末就写进提醒，
        页面上看得见 —— 这是唯一能自动发现「读错数字」的关卡。
        同一家银行同一个账户同一个月重复导入是覆盖，不会叠加。
    bills                       按月列出，含真实支出（已剔除本人账户调拨）
    bill:show 2026-04 [--detail]
    finance:pending             把「待归类交易」那条待办按全库现状刷一遍
        全库汇总成一条（不是一个月一条），归完类会自动关闭。
    bills:due <bills.json>      公用事业账单 → 一条「待缴账单」待办
        账单在 Gmail 里，脚本读不到 —— 我读邮件写 JSON，这个命令入库。
        每项：{供应商, 账号, 期数, 金额, 限期, 已缴}

  专题（一件我们一起跟进的事：洗牙、买小狗……判据是「要不要建表」）
    topics [--all]              默认只看在进行的
    topic:new "洗牙" [--category 生活] [--summary "一句话"]
    topic:show <id>             全貌：现状、未解决、任务、附件、相关记录
    topic:update <id> [--status settled|parked] [--body ...] [--summary ...]
    topic:page <id> <页面.html> 设置/替换呈现页 —— **就地覆盖，不堆重复文件**
    topic:q <id> "还没确认的事" [--note 线索]         加一条未解决
    topic:qdone <id> <第几条> [--note 答案] [--undo]   划掉它
    topic:rm <id>
        未解决数归零就是这个专题完成了 —— 卡片上显示的就是它。

  邮件
    mail:scan                   邮件扫描台账：哪些主题该重扫、上次扫到哪天
        脚本读不到 Gmail，这里只记水位线 —— 没有它我每次都得从头搜一遍。
    mail:seen <主题名> [--date] 扫完一个主题后推进水位线

  健康（家庭成员 + 体检报告 —— 报告发我，我读图直接结构化，不走 OCR）
    members / member:add "家人" --relation 父亲 [--gender male] [--birth 1956-03-15]
        [--chronic 糖尿病] [--allergies ...] [--blood A] [--height 165] [--weight 65]
    member:update <id> [同上各项]
    health:import <report.json> [--attach <原件>]…   把我读出来的结果落库
        同一人同一天同一种报告重导是覆盖，不叠加
    health [--member 家人]      按体检日期倒序列出
    health:show <报告 id> [--abnormal]   逐项看，--abnormal 只看不正常的
    health:trend "血糖" [--member 家人]  同一指标跨报告拉平看走势
    health:rm <报告 id>                 删掉一份报告（导错日期时只能删了重来）

  保险（保单台账 —— 页面在 /insurance，不在底栏，入口从「全家保险」专题进）
    policy [--all]                看台账：谁的、多少钱、下次什么时候交、红线在哪
    policy:add "产品名" --no <保单号> --insured 主人 --premium 2268
        [--relation 本人] [--insurer ...] [--kind medical|critical|life|cancer]
        [--region cn|overseas] [--currency CNY|USD|HKD] [--due 10-25] [--sum 1000000]
        [--start ...] [--end ...] [--first 首次投保日] [--guaranteed] [--until ...]
        [--redline 2027-03-14] [--redline-note "..."] [--vault <id>] [--topic <id>]
        注：--sum 是**整数元**不是分（600 万填 6000000）；--premium 是元，会自动转分
    policy:renew <保单号> --from 2026-10-26 --to 2027-10-25 [--premium 2350] [--paid ...]
        进入新的保险期间，同时改保费、记一笔缴纳。不给 --premium 就沿用旧的
    policy:pay <保单号> [--on 2026-08-25] [--amount 1321] [--via 微信自动扣款] [--tx <交易id>]
        只记一笔保费，不动保险期间
    ★ renew 和 pay 别混：renew 是「进入新的保险期间」（内地那几份一年一续）；
      pay 是「长期合同的又一期保费」（比如保 30 年、缴 20 年，期间不变）。
      拿 renew 记长期重疾险，会把 30 年的保障期改成 1 年 —— 台账就写坏了。

  文稿（成篇的文字：发言稿、文章、信件 —— 用来读，不是用来查）
    doc:add <md 文件> [--title ...] [--category 发言稿] [--occasion "某某晚会"]
        [--date 2026-03-11] [--summary ...] [--tags a,b]
    doc:ls [--category 发言稿]   doc:show <id>   doc:rm <id>
    doc:update <id> [--body-from <md 文件>]   源文件改了之后重新同步正文

  资料库
    vault [--q 关键词] [--category 银行]
    vault:add "名称" --category 银行 --field "账号=12345" --field "开户行=中环分行"
        [--secret "密码=xxx"]   显式标记为密码，网页上打码显示
        [--notes ...] [--tags "工资,常用"] [--sensitive]
        注：label 里带「密码/password/pin」的 --field 会自动当作密码处理；
            网址会在网页上渲染成可点击的链接
    vault:update <id> [--field "账号=新值"] [--notes ...] [--title ...]
    vault:show <id>
    vault:rm <id>

  文件
    files [--category 税单] [--limit 20]
    file:add <本地路径> [--category 税单] [--note ...] [--task <id>] [--vault <id>] [--doc <id>]
        [--name "规范文件名.jpg"]   重命名（上传来的文件常带随机前缀）
    file:rm <id>                删除文件（数据库记录 + 磁盘文件）
    file:path <id>              打印文件在磁盘上的绝对路径（供我直接读取）

  概览
    stats                       未处理消息 / 未完成任务 / 资料条数
`);
  },

  async inbox() {
    const where = flags.all ? {} : { role: 'user', status: 'pending' };
    const msgs = await db.message.findMany({
      where,
      orderBy: { createdAt: flags.all ? 'desc' : 'asc' },
      take: Number(flags.limit ?? 30),
      include: { attachments: true, task: { select: { id: true, title: true } } },
    });
    if (msgs.length === 0) return console.log('收件箱是空的，没有待处理消息。');
    for (const m of msgs) {
      line();
      // ★ 留言人要打出来。平台上「+ 交结果」和留言板都可能是代办人发的，
      // 而我回她和回主人，答案是不一样的 —— 看漏了就会答错对象。
      const who = m.role === 'user' ? (m.sender ?? '主人') : '管家';
      console.log(`[${who}] ${m.createdAt.toLocaleString('zh-CN')}  id=${m.id}  ${m.status}`);
      console.log(m.content);
      for (const a of m.attachments) {
        console.log(`  [附件] ${a.filename}  (${a.size}B)  id=${a.id}`);
        console.log(`         ${abs(a.storedPath)}`);
      }
      if (m.task) console.log(`  [任务] ${m.task.title} (${m.task.id})`);
    }
    line();
    console.log(`共 ${msgs.length} 条`);
  },

  /** 记录一轮沟通：主人说了什么 + 我怎么回的 */
  async log() {
    const taskId = flags.task ? String(flags.task) : null;
    const conversationId = taskId ? null : await chatConversation();
    // --topic：把这一轮挂到专题上，专题页才聚得到。Message.topicId 一直就有，
    // 只是 log 以前没开这个口子 —— 2026-09-12 记周末活动那轮才发现。
    const topicId = flags.topic ? String(flags.topic) : null;
    let wrote = 0;

    if (typeof flags.user === 'string') {
      await db.message.create({
        // 主人的话是留档，不需要我再处理，直接 handled
        data: {
          role: 'user',
          sender: flags.sender ? String(flags.sender) : null,
          content: flags.user,
          status: 'handled',
          taskId,
          topicId,
          conversationId,
        },
      });
      wrote++;
    }

    if (typeof flags.reply === 'string') {
      const msg = await db.message.create({
        data: { role: 'secretary', content: flags.reply, status: 'unread', taskId, topicId, conversationId },
      });
      await attachTo(msg.id);
      wrote++;
    }

    if (wrote === 0) return console.error('至少要给 --user 或 --reply 其中一个');
    console.log(`已记入平台（${wrote} 条）`);
  },

  async reply() {
    const content = positional[0];
    if (!content) return console.error('缺少回复内容');
    const taskId = flags.task ? String(flags.task) : null;
    const msg = await db.message.create({
      data: {
        role: 'secretary',
        content,
        status: 'unread',
        taskId,
        conversationId: taskId ? null : await chatConversation(),
      },
    });
    await attachTo(msg.id);
    console.log(`已回复 (id=${msg.id})`);
  },

  /** 回看最近的记录，确认主人在平台上看到的是什么 */
  async timeline() {
    const msgs = await db.message.findMany({
      orderBy: { createdAt: 'desc' },
      take: Number(flags.limit ?? 20),
      include: { attachments: true, task: { select: { title: true } } },
    });
    if (msgs.length === 0) return console.log('平台上还没有记录。');
    for (const m of msgs.reverse()) {
      line();
      const who = m.role === 'user' ? (m.sender ?? '主人') : '管家';
      console.log(`[${who}] ${m.createdAt.toLocaleString('zh-CN')}  id=${m.id}`);
      console.log(m.content);
      for (const a of m.attachments) console.log(`  [附件] ${a.filename}  ${abs(a.storedPath)}`);
      if (m.task) console.log(`  [任务] ${m.task.title}`);
    }
    line();
    console.log(`共 ${msgs.length} 条`);
  },

  async handled() {
    if (flags.all) {
      const r = await db.message.updateMany({
        where: { role: 'user', status: 'pending' },
        data: { status: 'handled' },
      });
      return console.log(`${r.count} 条消息标记为已处理`);
    }
    if (positional.length === 0) return console.error('请给出消息 id，或用 --all');
    const r = await db.message.updateMany({
      where: { id: { in: positional } },
      data: { status: 'handled' },
    });
    console.log(`${r.count} 条消息标记为已处理`);
  },

  /* ── 专题 ─────────────────────────────────────────────
     一件我们一起跟进的事。判据是「要不要建表」——不用建表的归这里。
     核心指标是**还没搞清楚几件事**，归零就算完。 */

  async topics() {
    const where = flags.all ? {} : { status: 'active' };
    const list = await db.topic.findMany({
      where,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: { _count: { select: { tasks: true, attachments: true } } },
    });
    if (list.length === 0) return console.log('还没有专题。topic:new "洗牙" 建一个。');
    for (const t of list) {
      line();
      const qs = parseQuestions(t.questions);
      const open = qs.filter((q) => !q.done).length;
      console.log(`[${TOPIC_STATUS[t.status] ?? t.status}] ${t.title}   id=${t.id}`);
      console.log(`  分类: ${t.category}${t.summary ? `  ·  ${t.summary}` : ''}`);
      console.log(
        `  未解决 ${open}/${qs.length}  ·  任务 ${t._count.tasks}  ·  附件 ${t._count.attachments}` +
          `  ·  ${t.page ? '有呈现页' : '无呈现页'}  ·  更新于 ${t.updatedAt.toLocaleDateString('zh-CN')}`
      );
    }
    line();
    console.log(`共 ${list.length} 个${flags.all ? '' : '（在进行的；--all 看全部）'}`);
  },

  async 'topic:new'() {
    const title = positional[0];
    if (!title) return console.error('用法: topic:new "洗牙" [--category 生活] [--summary "一句话"]');
    const t = await db.topic.create({
      data: {
        title,
        summary: flags.summary ? String(flags.summary) : null,
        category: String(flags.category ?? '其他'),
        body: flags.body ? String(flags.body) : null,
        tags: flags.tags ? String(flags.tags) : null,
      },
    });
    console.log(`已建专题 ${t.id}: ${t.title}`);
  },

  async 'topic:show'() {
    const t = await db.topic.findUnique({
      where: { id: positional[0] ?? '' },
      include: { tasks: true, attachments: true, messages: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    if (!t) return console.error('找不到这个专题');
    line();
    console.log(`${t.title}   [${TOPIC_STATUS[t.status] ?? t.status}]  ${t.category}`);
    if (t.summary) console.log(t.summary);
    line();
    if (t.body) console.log(t.body + '\n');
    const qs = parseQuestions(t.questions);
    if (qs.length) {
      console.log(`还没搞清楚的（${qs.filter((q) => !q.done).length}/${qs.length}）：`);
      qs.forEach((q, i) => console.log(`  ${q.done ? '☑' : '☐'} ${i + 1}. ${q.q}${q.note ? `　— ${q.note}` : ''}`));
      console.log('');
    }
    for (const x of t.tasks) console.log(`  [任务/${x.status}] ${x.title}  id=${x.id}`);
    for (const a of t.attachments) console.log(`  [附件] ${a.filename}  ${abs(a.storedPath)}`);
    for (const m of t.messages) console.log(`  [记录/${m.role}] ${m.content.slice(0, 60).replace(/\n/g, ' ')}…`);
    line();
    console.log(`呈现页: ${t.page ? `${t.page.length} 字符  →  /topics/${t.id}/page` : '还没有'}`);
  },

  async 'topic:update'() {
    const id = positional[0];
    if (!id) return console.error('用法: topic:update <id> [--status settled] [--summary ...] [--body ...] [--title ...]');
    const data = {};
    for (const k of ['title', 'summary', 'category', 'body', 'tags']) {
      if (flags[k] !== undefined) data[k] = String(flags[k]);
    }
    if (flags.status !== undefined) {
      const st = String(flags.status);
      if (!TOPIC_STATUS[st]) return console.error(`status 只能是 ${Object.keys(TOPIC_STATUS).join(' / ')}`);
      data.status = st;
    }
    if (Object.keys(data).length === 0) return console.error('没有要改的字段');
    const t = await db.topic.update({ where: { id }, data });
    console.log(`已更新 ${t.title}`);
  },

  /** 设置/替换呈现页。**就地覆盖**，不会像 file:add 那样堆出一堆重复记录。 */
  async 'topic:page'() {
    const [id, htmlPath] = positional;
    if (!id || !htmlPath) return console.error('用法: topic:page <id> <页面.html>');
    const html = await readFile(path.resolve(htmlPath), 'utf8');
    const t = await db.topic.update({ where: { id }, data: { page: html } });
    console.log(`已更新呈现页（${html.length} 字符）→ /topics/${t.id}/page`);
  },

  /** 加一条「还没搞清楚的事」。这是专题的核心指标，归零就算完。 */
  async 'topic:q'() {
    const [id, ...rest] = positional;
    const text = rest.join(' ');
    if (!id || !text) return console.error('用法: topic:q <id> "还没确认的事" [--note "线索"]');
    const t = await db.topic.findUnique({ where: { id } });
    if (!t) return console.error('找不到这个专题');
    const qs = parseQuestions(t.questions);
    qs.push({ q: text, note: flags.note ? String(flags.note) : '', done: false });
    await db.topic.update({ where: { id }, data: { questions: JSON.stringify(qs) } });
    console.log(`已记下第 ${qs.length} 条，未解决 ${qs.filter((x) => !x.done).length} 条`);
  },

  /** 划掉第 N 条（1 起数）。--undo 反悔。 */
  async 'topic:qdone'() {
    const [id, n] = positional;
    if (!id || !n) return console.error('用法: topic:qdone <id> <第几条> [--note "答案"] [--undo]');
    const t = await db.topic.findUnique({ where: { id } });
    if (!t) return console.error('找不到这个专题');
    const qs = parseQuestions(t.questions);
    const i = Number(n) - 1;
    if (!qs[i]) return console.error(`只有 ${qs.length} 条`);
    qs[i].done = !flags.undo;
    if (flags.note) qs[i].note = String(flags.note);
    await db.topic.update({ where: { id }, data: { questions: JSON.stringify(qs) } });
    console.log(`${qs[i].done ? '已划掉' : '已恢复'}：${qs[i].q}`);
    console.log(`还剩 ${qs.filter((x) => !x.done).length} 条没搞清楚`);
  },

  async 'topic:rm'() {
    const id = positional[0];
    if (!id) return console.error('用法: topic:rm <id>');
    const t = await db.topic.delete({ where: { id } });
    console.log(`已删除专题「${t.title}」（关联的任务/记录/附件不删，只是解开关联）`);
  },

  async tasks() {
    const tasks = await db.task.findMany({
      where: {
        ...(flags.status ? { status: String(flags.status) } : {}),
        ...(flags.category ? { category: String(flags.category) } : {}),
        // --owner none 查「还没指派给谁的」—— 那格最该被看见，
        // 没人认领的事最容易两个人都以为对方在办。
        ...(flags.owner ? (flags.owner === 'none' ? { owner: null } : { owner: String(flags.owner) }) : {}),
      },
      orderBy: [{ status: 'asc' }, { priority: 'asc' }, { updatedAt: 'desc' }],
      include: {
        attachments: true,
        doc: { select: { id: true, title: true } },
        blocker: { select: { title: true, status: true, dueDate: true } },
      },
    });
    if (tasks.length === 0) return console.log('没有符合条件的任务。');
    for (const t of tasks) {
      line();
      console.log(`[${t.status}] P${t.priority} ${t.title}   id=${t.id}`);
      const due = t.dueDate ? `  截止: ${t.dueDate.toLocaleDateString('zh-CN')}` : '';
      console.log(`  负责: ${t.owner ?? '未指派'}  分类: ${t.category}${due}`);
      if (t.detail) console.log(`  说明: ${t.detail}`);
      if (t.result) console.log(`  反馈: ${t.result}`);
      if (t.doc) console.log(`  [文稿] 《${t.doc.title}》  /docs/${t.doc.id}`);
      if (t.blocker) {
        const stuck = !['done', 'cancelled'].includes(t.blocker.status);
        console.log(`  ${stuck ? '⏳ 等' : '✅ 前置已完成'}: ${t.blocker.title}`);
        if (t.blocker.dueDate && t.dueDate && t.blocker.dueDate >= t.dueDate)
          console.log('     ⚠ 前置的截止日不早于这条 —— 排期有问题');
      }
      for (const a of t.attachments) console.log(`  [附件] ${a.filename}  ${abs(a.storedPath)}`);
    }
    line();
    console.log(`共 ${tasks.length} 项`);
  },

  async 'task:new'() {
    const title = positional[0];
    if (!title) return console.error('缺少任务标题');
    const t = await db.task.create({
      data: {
        title,
        detail: flags.detail ? String(flags.detail) : null,
        category: String(flags.category ?? '其他'),
        priority: Number(flags.priority ?? 2),
        dueDate: flags.due ? new Date(String(flags.due)) : null,
        status: String(flags.status ?? 'todo'),
        // 挂到专题下。专题页要把相关任务聚过来，不挂就聚不到 ——
        // 而任务分类只是个字符串，指望「分类=保险」去反查，换个叫法就断了。
        topicId: flags.topic ? String(flags.topic) : null,
        owner: flags.owner ? String(flags.owner) : null,
        docId: flags.doc ? String(flags.doc) : null,
        blocksOn: flags.after ? String(flags.after) : null,
      },
    });
    console.log(`已创建任务 ${t.id}: ${t.title}${t.owner ? `（负责: ${t.owner}）` : ''}`);
  },

  async 'task:update'() {
    const id = positional[0];
    if (!id) return console.error('缺少任务 id');
    const data = {};
    for (const k of ['status', 'result', 'title', 'detail', 'category']) {
      if (flags[k] !== undefined) data[k] = String(flags[k]);
    }
    if (flags.priority) data.priority = Number(flags.priority);
    if (flags.due) data.dueDate = new Date(String(flags.due));
    if (flags.topic !== undefined) data.topicId = flags.topic === 'none' ? null : String(flags.topic);
    if (flags.owner !== undefined) data.owner = flags.owner === 'none' ? null : String(flags.owner);
    if (flags.doc !== undefined) data.docId = flags.doc === 'none' ? null : String(flags.doc);
    if (flags.after !== undefined) data.blocksOn = flags.after === 'none' ? null : String(flags.after);
    const t = await db.task.update({ where: { id }, data });
    console.log(`已更新任务 ${t.id} → ${t.status}（负责: ${t.owner ?? '未指派'}）`);
  },

  async 'task:show'() {
    const t = await db.task.findUnique({
      where: { id: positional[0] },
      include: { attachments: true, messages: true },
    });
    console.log(t ? j(t) : '未找到该任务');
  },

  async vault() {
    const q = flags.q ? String(flags.q) : null;
    const items = await db.vaultItem.findMany({
      where: {
        ...(flags.category ? { category: String(flags.category) } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { fields: { contains: q } },
                { notes: { contains: q } },
                { tags: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });
    if (items.length === 0) return console.log('资料库中没有匹配的条目。');
    for (const it of items) {
      line();
      console.log(`【${it.category}】${it.title}   id=${it.id}${it.sensitive ? '  [敏感]' : ''}`);
      for (const f of JSON.parse(it.fields || '[]')) console.log(`  ${f.label}: ${f.value}`);
      if (it.notes) console.log(`  备注: ${it.notes}`);
      if (it.tags) console.log(`  标签: ${it.tags}`);
    }
    line();
    console.log(`共 ${items.length} 条`);
  },

  // ---------- 账单 ----------

  /**
   * 账单入库。
   *
   * 跟主平台最大的差别：**这边没有解析器**。主平台那套是认某一家银行月结单
   * 版式的 Python 规则，换一家银行就废了。这一版是 AI 直接读账单（拍的照片、
   * 截图、PDF 都行）自己写 JSON —— 跟体检报告一个路子，不挑银行、不挑国家。
   *
   * 代价是数字由模型读出来，**会读错**。所以入库时做一次余额勾稽：
   * 期初 + 进账 − 出账 应该等于期末，对不上就把差额写进 note，页面上看得见。
   * 宁可让人看到「这个月对不上 300 块」，也不要默默入一笔错账。
   *
   *   finance:import <账单.json> [--attach <原件>…]
   *
   * JSON 形状：
   * {
   *   "bank": "招商银行",            // 照抄账单上印的，必填
   *   "account": "main",             // 有多本账才分，只有一本就 main
   *   "period": "2026-04",           // 必填，跨月对比按它排
   *   "statementDate": "2026-05-01",
   *   "openingTotalCents": 1234500,  // 期初余额（分）。有就填，勾稽要用
   *   "closingTotalCents": 1150000,  // 期末余额（分）
   *   "warnings": ["第 3 笔金额模糊，按 128.00 记"],
   *   "transactions": [
   *     { "date": "2026-04-03", "direction": "debit", "amountCents": 12800,
   *       "currency": "CNY", "baseCents": 12800, "counterparty": "永辉超市",
   *       "category": "daily_life", "label": "超市采购",
   *       "rawText": "账单上那一行的原文" }
   *   ]
   * }
   *
   * category 只能用这几个：fixed_cost 固定成本 · daily_life 日常生活 ·
   * tools_subscription 工具订阅 · big_purchase 大额采购 · salary 工资 ·
   * other_income 其他收入 · self_transfer 本人账户调拨 · pass_through 资金往来 ·
   * balance 余额项 · uncategorized 待确认。
   * **拿不准就填 uncategorized**，页面会单独列出来问，比猜错了混进支出强。
   */
  async 'finance:import'() {
    const src = positional[0];
    if (!src) {
      return console.error('用法: finance:import <账单.json> [--attach <原件>]');
    }
    const payload = JSON.parse(await readFile(path.resolve(src), 'utf8'));

    // 用 exitCode 而不是静默 return：这些命令以后由网页 agent 自动调用，
    // 它靠退出码判断「这次到底导进去没有」。返回 0 会被当成成功。
    if (!payload.bank) { process.exitCode = 1; return console.error('缺少 bank（银行名），照抄账单上印的'); }
    if (!payload.period) { process.exitCode = 1; return console.error('缺少 period（形如 2026-04）'); }
    const rows = payload.transactions ?? [];

    const key = { bank: payload.bank, account: payload.account ?? 'main', period: payload.period };

    // 余额勾稽。模型读错一个数字，这里就对不上 —— 这是唯一一道能自动发现
    // 「读错了」的关卡，别省。
    const warnings = [...(payload.warnings ?? [])];
    const sum = (dir) => rows
      .filter((r) => (r.direction ?? 'debit') === dir && r.category !== 'balance')
      .reduce((a, r) => a + (r.baseCents ?? r.amountCents ?? 0), 0);
    const { openingTotalCents: open, closingTotalCents: close } = payload;
    if (typeof open === 'number' && typeof close === 'number') {
      const expected = open + sum('credit') - sum('debit');
      const diff = close - expected;
      if (diff !== 0) {
        warnings.push(
          `余额对不上：期初 ${(open / 100).toFixed(2)} + 进账 ${(sum('credit') / 100).toFixed(2)}` +
          ` − 出账 ${(sum('debit') / 100).toFixed(2)} = ${(expected / 100).toFixed(2)}，` +
          `但账单写的期末是 ${(close / 100).toFixed(2)}，差 ${(diff / 100).toFixed(2)}。` +
          `多半是有笔交易读漏了或金额读错了`
        );
      }
    } else {
      warnings.push('账单没给期初/期末余额，这次没做余额勾稽 —— 金额对不对没法自动验');
    }

    const meta = {
      statementDate: payload.statementDate ? new Date(payload.statementDate) : null,
      openingTotalCents: open ?? null,
      closingTotalCents: close ?? null,
      closingBalanceCents: payload.closingBalanceCents ?? null,
      sourcePath: payload.sourcePath ?? null,
      note: warnings.length ? warnings.join('；') : null,
    };

    const st = await db.statement.upsert({
      where: { bank_account_period: key },
      create: { ...key, ...meta },
      update: meta,
    });

    // 重新导入同一个月 = 覆盖，不是叠加。否则读错了重导一次就成双份。
    const removed = await db.transaction.deleteMany({ where: { statementId: st.id } });
    await db.transaction.createMany({
      data: rows.map((r) => ({
        statementId: st.id,
        date: new Date(r.date),
        direction: r.direction ?? 'debit',
        amountCents: r.amountCents ?? 0,
        balanceCents: r.balanceCents ?? null,
        currency: r.currency ?? 'CNY',
        account: r.account ?? key.account,
        // 本位币等值。折算不出来时退回原值，宁可算少也别留空 ——
        // 留空会让汇总时的 sum 静默漏掉这一笔。
        baseCents: r.baseCents ?? r.amountCents ?? null,
        counterparty: r.counterparty ?? null,
        kind: r.kind ?? null,
        category: r.category ?? 'uncategorized',
        label: r.label ?? null,
        rawText: r.rawText ?? null,
      })),
    });

    // --attach 要支持给多张（账单常常是好几页截图），但 flags 解析是覆盖式的，
    // 重复的 --attach 只会留下最后一个。所以直接从 argv 里捞。
    const attachPaths = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--attach' && argv[i + 1] && !argv[i + 1].startsWith('--')) {
        attachPaths.push(argv[i + 1]);
      }
    }
    for (const a of attachPaths) {
      const already = await db.attachment.findFirst({
        where: { statementId: st.id, filename: path.basename(a) },
      });
      if (already) {
        console.log(`  原件已在平台里，跳过：${already.filename}`);
        continue;
      }
      const m = await ingestFile(a);
      await db.attachment.create({
        data: { ...m, category: '账单', statementId: st.id, uploadedBy: 'secretary',
                note: `${payload.period} 账单原件` },
      });
    }

    // 待确认的交易汇总成**一条**待办 —— 否则它们只是躺在财务页上，没有任何
    // 东西推着去处理。注意是全库汇总的一条，不是一个月一条：那些不是主人的
    // 待办，是**我认不出这笔钱花在哪、等着问他**的工作笔记。
    await syncPendingTask();

    console.log(`已导入 ${st.period}：${rows.length} 笔${removed.count ? `（覆盖了原有 ${removed.count} 笔）` : ''}`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  },

  /** 手工改完分类、或者只想把那条待归类待办刷一遍时用。不导账单也能跑。 */
  async 'finance:pending'() {
    await syncPendingTask();
  },

  /**
   * 公用事业账单 → 一条「待缴账单」待办。
   *
   * **账单在 Gmail 里，而这个脚本读不到 Gmail** —— 中电、水务署、电话公司每月
   * 发一封带金额和缴款限期的邮件，只有我（在会话里用邮件连接器）能看见。
   * 所以流程是：**我读邮件 → 写一份 JSON → 这个命令入库**，跟体检报告一个路子。
   *
   *   node scripts/secretary.mjs bills:due <bills.json>
   *
   * JSON 是一个数组，每项：
   *   { "供应商": "中电", "账号": "82864-36981-0", "期数": "2026-07",
   *     "金额": 1053.00, "限期": "2026-08-15", "已缴": false }
   *
   * 「已缴」为 true 的会从待办里消失（但留在 JSON 里，下次不用重查）。
   */
  async 'bills:due'() {
    const src = positional[0];
    if (!src) return console.error('用法: bills:due <bills.json>');
    const rows = JSON.parse(await readFile(path.resolve(src), 'utf8'));
    await syncBillsDueTask(rows);
  },

  /**
   * 邮件扫描台账。**这个命令读不到 Gmail**，它只回答一个问题：
   * 「哪些主题该重新扫了，上次扫到哪天为止。」
   *
   * 为什么需要它：邮件是我在会话里读的，会话一结束我就全忘了。没有水位线，
   * 下次就得从头再搜一遍同样的邮件 —— 又慢又可能重复建任务。
   */
  async 'mail:scan'() {
    const ledger = await readLedger();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    line();
    let due = 0;
    for (const t of ledger.主题 ?? []) {
      const last = new Date(t.扫到 + 'T00:00:00');
      const days = Math.floor((today.getTime() - last.getTime()) / 86400000);
      const overdue = days >= (t.周期天数 ?? 30);
      if (overdue) due++;
      console.log(`${overdue ? '⚠ 该扫了' : '  还行  '}  ${t.名称.padEnd(14)} 上次 ${t.扫到}（${days} 天前，周期 ${t.周期天数} 天）`);
      console.log(`             搜: ${t.查询} after:${t.扫到.replace(/-/g, '/')}`);
      if (t.去向) console.log(`             去向: ${t.去向}`);
    }
    line();

    const open = (ledger.已处理 ?? []).filter((x) => x.未解决);
    if (open.length) {
      console.log(`翻过但还没了结的 ${open.length} 条：`);
      for (const x of open) console.log(`  ${x.日期}  ${x.内容}\n      ⤷ ${x.未解决}`);
      line();
    }
    console.log(due ? `${due} 个主题该重新扫了。` : '都还新鲜，这轮可以跳过。');
    console.log(`共记了 ${(ledger.已处理 ?? []).length} 条已处理邮件，台账在 ${MAIL_LEDGER}`);
  },

  /** 扫完一个主题后推进水位线：mail:seen 公用事业账单 [--date 2026-08-23] */
  async 'mail:seen'() {
    const name = positional[0];
    const ledger = await readLedger();
    const t = (ledger.主题 ?? []).find((x) => x.名称 === name);
    if (!t) {
      return console.error(
        `用法: mail:seen <主题名> [--date YYYY-MM-DD]\n现有主题: ${(ledger.主题 ?? []).map((x) => x.名称).join(' / ')}`
      );
    }
    t.扫到 = String(flags.date ?? new Date().toISOString().slice(0, 10));
    await writeFile(MAIL_LEDGER, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
    console.log(`「${t.名称}」水位线推到 ${t.扫到}`);
  },

  async bills() {
    const list = await db.statement.findMany({
      orderBy: { period: 'desc' },
      include: { transactions: { select: { category: true, direction: true, amountCents: true, baseCents: true } } },
    });
    if (list.length === 0) return console.log('还没有账单。把账单发我，我读完用 finance:import 入库。');
    for (const st of list) {
      line();
      console.log(`${st.period} ${st.bank}/${st.account}   id=${st.id}`);
      const spend = st.transactions
        .filter((t) => t.direction === 'debit' && !SPEND_EXCLUDED.includes(t.category))
        .reduce((a, t) => a + baseOf(t), 0);
      console.log(`  ${st.transactions.length} 笔 · 真实支出 ${money(spend)}`);
      if (st.closingBalanceCents != null) console.log(`  期末余额 ${money(st.closingBalanceCents)}`);
      if (st.note) console.log(`  提醒: ${st.note}`);
    }
    line();
    console.log(`共 ${list.length} 个月。`);
  },

  async 'bill:show'() {
    const period = positional[0];
    if (!period) return console.error('用法: bill:show 2026-04');
    const st = await db.statement.findFirst({
      where: { period },
      include: { transactions: { orderBy: { date: 'asc' } } },
    });
    if (!st) return console.error('没有这个月的账单');

    line();
    console.log(`${st.period}  资产 ${money(st.openingTotalCents)} → ${money(st.closingTotalCents)}`);
    const byCat = new Map();
    for (const t of st.transactions) {
      const k = `${t.category}:${t.direction}`;
      byCat.set(k, (byCat.get(k) ?? 0) + baseOf(t));
    }
    line();
    for (const [k, v] of [...byCat].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(30)} ${money(v)}`);
    }
    if (flags.detail) {
      line();
      for (const t of st.transactions) {
        const sign = t.direction === 'debit' ? '-' : '+';
        // 外币行同时显示原币，否则对不上账单上印的那个数字
        const orig = t.baseCents != null && t.baseCents !== t.amountCents
          ? `  (${t.currency} ${(t.amountCents / 100).toFixed(2)})` : '';
        console.log(`  ${t.date.toISOString().slice(0, 10)} ${sign}${money(baseOf(t)).padStart(12)}  ${t.label ?? ''}  ${t.counterparty ?? ''}${orig}`);
      }
    }
    line();
    console.log(`共 ${st.transactions.length} 笔。加 --detail 看明细。`);
  },

  // ---------- 文稿 ----------

  async 'doc:add'() {
    const src = positional[0];
    if (!src) {
      return console.error('用法: doc:add <md 文件> [--title ...] [--category 发言稿] [--date 2026-03-11]');
    }
    const raw = await readFile(path.resolve(src), 'utf8');
    const parsed = splitDoc(raw);
    const title = flags.title ? String(flags.title) : parsed.title;
    if (!title) return console.error('文件里没有一级标题，用 --title 指定');

    const d = await db.document.create({
      data: {
        title,
        category: String(flags.category ?? '其他'),
        body: parsed.body,
        summary: flags.summary ? String(flags.summary) : null,
        occasion: flags.occasion ? String(flags.occasion) : null,
        date: flags.date ? new Date(String(flags.date)) : null,
        tags: String(flags.tags ?? ''),
        sourcePath: relSource(src),
      },
    });
    console.log(`已收录文稿 ${d.id}: 【${d.category}】${d.title}（正文 ${d.body.length} 字）`);
  },

  async 'doc:ls'() {
    const docs = await db.document.findMany({
      where: flags.category ? { category: String(flags.category) } : {},
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { attachments: true },
    });
    if (docs.length === 0) return console.log('还没有文稿。用 doc:add <md 文件> 收录。');
    for (const d of docs) {
      line();
      console.log(`【${d.category ?? '其他'}】${d.title}   id=${d.id}`);
      if (d.occasion) console.log(`  场合: ${d.occasion}`);
      if (d.date) console.log(`  日期: ${d.date.toLocaleDateString('zh-CN')}`);
      console.log(`  正文: ${d.body.length} 字${d.sourcePath ? ` · 源文件 ${d.sourcePath}` : ''}`);
      if (d.attachments.length) console.log(`  附件: ${d.attachments.length} 个`);
    }
    line();
    console.log(`共 ${docs.length} 篇。`);
  },

  async 'doc:show'() {
    const id = positional[0];
    if (!id) return console.error('缺少 id');
    const d = await db.document.findUnique({ where: { id }, include: { attachments: true } });
    if (!d) return console.error('未找到该文稿');
    line();
    console.log(`【${d.category ?? '其他'}】${d.title}`);
    if (d.occasion) console.log(`场合: ${d.occasion}`);
    if (d.date) console.log(`日期: ${d.date.toLocaleDateString('zh-CN')}`);
    if (d.summary) console.log(`摘要: ${d.summary}`);
    if (d.sourcePath) console.log(`源文件: ${d.sourcePath}`);
    for (const a of d.attachments) console.log(`附件: ${a.filename}  ${abs(a.storedPath)}`);
    line();
    console.log(d.body);
    line();
  },

  async 'doc:update'() {
    const id = positional[0];
    if (!id) return console.error('缺少 id');
    const data = {};
    if (flags.title) data.title = String(flags.title);
    if (flags.category) data.category = String(flags.category);
    if (flags.summary) data.summary = String(flags.summary);
    if (flags.occasion) data.occasion = String(flags.occasion);
    if (flags.date) data.date = new Date(String(flags.date));
    if (flags.tags) data.tags = String(flags.tags);
    // 源文件改了之后重新同步正文：git 那份是源，数据库那份负责好看
    if (flags['body-from']) {
      const raw = await readFile(path.resolve(String(flags['body-from'])), 'utf8');
      data.body = splitDoc(raw).body;
      data.sourcePath = relSource(String(flags['body-from']));
    }
    if (Object.keys(data).length === 0) return console.error('没有要改的内容');
    const d = await db.document.update({ where: { id }, data });
    console.log(`已更新文稿 ${d.id}: ${d.title}`);
  },

  async 'doc:rm'() {
    const id = positional[0];
    if (!id) return console.error('缺少 id');
    const d = await db.document.delete({ where: { id } });
    console.log(`已删除文稿: ${d.title}`);
    if (d.sourcePath) console.log(`源文件 ${d.sourcePath} 还在，需要的话自己删。`);
  },

  async 'vault:add'() {
    const title = positional[0];
    if (!title) return console.error('缺少名称');
    const fields = [...parseFields(repeated('field')), ...parseFields(repeated('secret'), true)];
    const it = await db.vaultItem.create({
      data: {
        title,
        category: String(flags.category ?? '其他'),
        fields: JSON.stringify(fields),
        notes: flags.notes ? String(flags.notes) : null,
        tags: String(flags.tags ?? ''),
        sensitive: !!flags.sensitive,
      },
    });
    console.log(`已保存资料 ${it.id}: 【${it.category}】${it.title}（${fields.length} 个字段）`);
  },

  async 'vault:update'() {
    const id = positional[0];
    if (!id) return console.error('缺少 id');
    const cur = await db.vaultItem.findUnique({ where: { id } });
    if (!cur) return console.error('未找到该条目');

    const fields = JSON.parse(cur.fields || '[]');
    const incoming = [...parseFields(repeated('field')), ...parseFields(repeated('secret'), true)];
    for (const f of incoming) {
      const hit = fields.find((x) => x.label === f.label);
      if (hit) {
        hit.value = f.value;
        hit.secret = f.secret;
      } else fields.push(f);
    }

    const data = { fields: JSON.stringify(fields) };
    for (const k of ['title', 'category', 'notes', 'tags']) {
      if (flags[k] !== undefined) data[k] = String(flags[k]);
    }
    if (flags.sensitive !== undefined) data.sensitive = !!flags.sensitive;
    const it = await db.vaultItem.update({ where: { id }, data });
    console.log(`已更新资料 ${it.id}: ${it.title}`);
  },

  async 'vault:show'() {
    const it = await db.vaultItem.findUnique({
      where: { id: positional[0] },
      include: { attachments: true },
    });
    console.log(it ? j({ ...it, fields: JSON.parse(it.fields || '[]') }) : '未找到该条目');
  },

  async 'vault:rm'() {
    await db.vaultItem.delete({ where: { id: positional[0] } });
    console.log('已删除');
  },

  async files() {
    const list = await db.attachment.findMany({
      where: flags.category ? { category: String(flags.category) } : {},
      orderBy: { createdAt: 'desc' },
      take: Number(flags.limit ?? 30),
      include: { task: { select: { title: true } }, vaultItem: { select: { title: true } } },
    });
    if (list.length === 0) return console.log('没有文件。');
    for (const f of list) {
      line();
      console.log(`${f.filename}  (${f.size}B, ${f.mimeType})  id=${f.id}`);
      console.log(`  ${abs(f.storedPath)}`);
      const from = f.uploadedBy === 'user' ? '主人上传' : '管家生成';
      console.log(`  ${f.createdAt.toLocaleString('zh-CN')} · ${from}${f.category ? ` · ${f.category}` : ''}`);
      if (f.note) console.log(`  备注: ${f.note}`);
      if (f.task) console.log(`  任务: ${f.task.title}`);
      if (f.vaultItem) console.log(`  资料: ${f.vaultItem.title}`);
    }
    line();
    console.log(`共 ${list.length} 个`);
  },

  async 'file:add'() {
    const src = positional[0];
    if (!src) return console.error('缺少文件路径');
    const meta = await ingestFile(src);
    const a = await db.attachment.create({
      data: {
        ...meta,
        category: flags.category ? String(flags.category) : null,
        note: flags.note ? String(flags.note) : null,
        taskId: flags.task ? String(flags.task) : null,
        vaultItemId: flags.vault ? String(flags.vault) : null,
        documentId: flags.doc ? String(flags.doc) : null,
        uploadedBy: 'secretary',
      },
    });
    console.log(`已收入文件 ${a.id}: ${a.filename}`);
  },

  /** 删除文件：数据库记录和磁盘文件一起清掉 */
  async 'file:rm'() {
    const f = await db.attachment.findUnique({ where: { id: positional[0] } });
    if (!f) return console.error('未找到该文件');
    await db.attachment.delete({ where: { id: f.id } });
    try {
      await unlink(abs(f.storedPath));
    } catch {
      console.log('（磁盘上的文件已不在，只清了数据库记录）');
    }
    console.log(`已删除 ${f.filename}`);
  },

  async 'file:path'() {
    const f = await db.attachment.findUnique({ where: { id: positional[0] } });
    console.log(f ? abs(f.storedPath) : '未找到该文件');
  },

  async stats() {
    const [pending, unread, open, done, vault, files] = await Promise.all([
      db.message.count({ where: { role: 'user', status: 'pending' } }),
      db.message.count({ where: { role: 'secretary', status: 'unread' } }),
      db.task.count({ where: { status: { in: ['todo', 'doing', 'blocked'] } } }),
      db.task.count({ where: { status: 'done' } }),
      db.vaultItem.count(),
      db.attachment.count(),
    ]);
    console.log(
      [
        `待我处理的消息: ${pending}`,
        `主人未读的回复: ${unread}`,
        `未完成任务:     ${open}`,
        `已完成任务:     ${done}`,
        `资料库条目:     ${vault}`,
        `文件:           ${files}`,
      ].join('\n')
    );
  },
};

// ---------- 工具 ----------
const MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  // 调研报告用。文件接口是 inline 发的，所以手机上点开是渲染好的网页，不是下载。
  // 没这一行会 fallback 成 octet-stream，变成下载一个打不开的文件。
  '.html': 'text/html; charset=utf-8',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** 把 --file 指向的文件收进平台并挂到某条消息下 */
/**
 * 把全库「待归类」的交易汇总成一条待办（`sourceKey = finance:uncategorized`）。
 *
 * **一条，不是一个月一条。** 这些不是主人的待办，是我的工作笔记 ——
 * 月结单原文没给出足够信息判断用途，我不猜，等着问他。一个月一条的话，
 * 导 18 个月就有 18 条 P2 待办压在任务页上，真正要办的事反而看不见了。
 *
 * 每次账单导入后重算：从 `Transaction` 表现查，不依赖本次导入的 payload ——
 * 这样补导旧月份、或者手工改完分类重跑，这条待办都会自己对上。
 * 全部归完类就自动关闭。
 */
async function syncPendingTask() {
  const key = 'finance:uncategorized';
  const rows = await db.transaction.findMany({
    where: { category: 'uncategorized' },
    include: { statement: { select: { period: true } } },
    orderBy: { date: 'asc' },
  });
  const existing = await db.task.findUnique({ where: { sourceKey: key } });

  if (rows.length === 0) {
    if (existing && !['done', 'cancelled'].includes(existing.status)) {
      await db.task.update({
        where: { id: existing.id },
        data: { status: 'done', result: '所有月份的交易都归类完了。' },
      });
      console.log('  已无待归类交易，那条待办自动关闭');
    }
    return;
  }

  const byPeriod = new Map();
  for (const t of rows) {
    const period = t.statement.period;
    if (!byPeriod.has(period)) byPeriod.set(period, []);
    byPeriod.get(period).push(t);
  }
  // 新的月份排前面 —— 越近的主人越可能还记得那笔钱是干嘛的
  const periods = [...byPeriod.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  // 只摊开最近 3 个月，更早的折成一行。
  // 一次把 45 笔全列出来，卡片有半屏高，而且没人会一口气认完 45 笔 ——
  // 问得越少答得越多。这几笔认掉了，下次重跑自然会把更早的翻上来。
  const SHOW = 3;
  const detailed = periods.slice(0, SHOW).map(([period, txs]) => {
    const items = txs.map(
      (t) =>
        `  ${t.date.toISOString().slice(0, 10)}  ` +
        // 这里给的是原币 —— 要认的是「这笔钱干什么用的」，原币加对手方
        // 最容易对上记忆。但外币必须标出币种，否则 2559 会被当成人民币看
        `${t.direction === 'debit' ? '支出' : '收入'} ` +
        `${t.currency && t.currency !== BASE_CURRENCY ? t.currency + ' ' : ''}${(t.amountCents / 100).toFixed(2)}  ` +
        `｜ ${t.counterparty || '原文没有对手方'}`
    );
    return [`**${period}**（${txs.length} 笔）`, ...items].join('\n');
  });

  const rest = periods.slice(SHOW);
  const restCount = rest.reduce((n, [, txs]) => n + txs.length, 0);
  const tail = rest.length
    ? `更早还有 ${rest.length} 个月共 ${restCount} 笔（${rest[0][0]} 至 ${rest[rest.length - 1][0]}），` +
      `等上面这些认完我再往前翻 —— 一次问太多反而认不出来。`
    : '';

  const data = {
    title: `待归类交易 ${rows.length} 笔（${byPeriod.size} 个月份）`,
    category: '财务',
    priority: 3,
    detail: [
      '月结单原文没给出足够信息判断用途，我不猜，等主人认。',
      '**不用一次认完** —— 想起哪笔说哪笔，越近的越容易记得，所以先列最近三个月。',
      '',
      detailed.join('\n\n'),
      ...(tail ? ['', tail] : []),
      '',
      '告知用途后我把它归好类，重导那个月覆盖，这里的笔数自己会减。',
    ].join('\n'),
  };

  if (existing) {
    await db.task.update({
      where: { id: existing.id },
      data: { ...data, status: 'todo', result: null },
    });
  } else {
    await db.task.create({ data: { ...data, sourceKey: key } });
  }
  console.log(`  待归类待办已更新：${data.title}`);
}

/**
 * 未缴账单 → **一条**待办（`sourceKey = finance:bills-due`）。
 *
 * 又是「汇总成一条」那条规矩：中电每月一封、水费两月一封、两个电话号各一封，
 * 一张账单一条待办的话，一年就是四五十条把任务页淹掉。合成一条，
 * **截止日取最近的那个** —— 任务页按截止日标红排序，取最早的才不会漏。
 *
 * 账单是「缴了就完了」的事，所以这条待办只列**未缴**的；全缴清就自动关闭。
 */
async function syncBillsDueTask(rows) {
  const key = 'finance:bills-due';
  const existing = await db.task.findUnique({ where: { sourceKey: key } });
  const open = (rows ?? []).filter((b) => !b.已缴 && b.限期);
  open.sort((a, b) => String(a.限期).localeCompare(String(b.限期)));

  if (open.length === 0) {
    if (existing && !['done', 'cancelled'].includes(existing.status)) {
      await db.task.update({
        where: { id: existing.id },
        data: { status: 'done', result: '账单都缴清了。' },
      });
      console.log('  没有未缴账单，那条待办自动关闭');
    }
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lines = open.map((b) => {
    // 加 T00:00:00 是必须的：new Date('2026-08-15') 按 **UTC 午夜** 解析，
    // 而 today 是本地午夜，东八区差 8 小时 —— 相减 floor 下来就少一天，
    // 卡片上会出现「已过期 7 天」而任务底部写「已过期 8 天」的自相矛盾。
    const due = new Date(b.限期 + 'T00:00:00');
    const late = Math.floor((today.getTime() - due.getTime()) / 86400000);
    const flag = late > 0 ? `**已过期 ${late} 天**` : late === 0 ? '**今天到期**' : `还有 ${-late} 天`;
    return `- **${b.供应商}**${b.期数 ? ` ${b.期数}` : ''}　${CURRENCY} ${Number(b.金额).toFixed(2)}　` +
           `限期 ${b.限期}　${flag}${b.账号 ? `\n  账号 ${b.账号}` : ''}`;
  });

  const data = {
    title: `待缴账单 ${open.length} 笔`,
    category: '居家',
    priority: 1,
    dueDate: new Date(open[0].限期),
    detail: [
      '从 Gmail 里的账单邮件整理出来的，**缴没缴我看不出来** —— 邮件里只有账单，',
      '没有缴费确认。缴过的告诉我一声，我把它划掉。',
      '',
      ...lines,
      '',
      '**中电欠费会停电**，这条的优先级是按它定的。',
    ].join('\n'),
  };

  if (existing) {
    await db.task.update({ where: { id: existing.id }, data: { ...data, status: 'todo', result: null } });
  } else {
    await db.task.create({ data: { ...data, sourceKey: key } });
  }
  console.log(`  待缴账单待办已更新：${data.title}（最近限期 ${open[0].限期}）`);
}

const TOPIC_STATUS = { active: '在进行', settled: '有结论', parked: '搁置' };

/** questions 存的是 JSON 数组，坏了或空着都当空数组处理，别让一条脏数据把命令搞挂。 */
function parseQuestions(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const MAIL_LEDGER = path.resolve('data/mail-scan.json');

/** 台账不存在也不报错 —— 第一次跑给个空壳，省得还要先手工建文件。 */
async function readLedger() {
  try {
    return JSON.parse(await readFile(MAIL_LEDGER, 'utf8'));
  } catch {
    return { 主题: [], 已处理: [] };
  }
}

async function attachTo(messageId) {
  if (!flags.file || typeof flags.file !== 'string') return;
  const meta = await ingestFile(flags.file);
  await db.attachment.create({
    data: {
      ...meta,
      messageId,
      uploadedBy: 'secretary',
      category: flags.category ? String(flags.category) : null,
      note: flags.note ? String(flags.note) : null,
    },
  });
  console.log(`已附带文件: ${meta.filename}`);
}

/** 这些字眼的字段在网页上默认打码 */
const SECRET_LABEL =
  // 密码类
  /密[码碼]|password|passcode|pwd|pin|secret|token|私钥|私鑰/i;

/**
 * 证件号码类也要默认打码。
 *
 * 第一次存身份证和港澳通行证时踩到：上面那条只认「密码」字样，证件号码全是
 * 明文摊在卡片上 —— 而证件号恰恰是最不该被人瞄一眼就记走的东西。
 *
 * 用「号码/號碼/证号/编号 + 具体证件名」两条并列，不要只写 `/号码/`：
 * 「手机」「电话号码」这些也带号码，打了码反而难用。
 */
const SECRET_ID_LABEL =
  /身份[证證]|通行[证證]|回[乡鄉][证證]|护照|護照|passport|签证|簽證|visa|出生[证證]|[证證]件号|[证證]号|电脑号码|電腦號碼|机读码|機讀碼|mrz/i;

/**
 * 拆开 writings/ 下的 md：一级标题当标题，第一条 --- 分隔线之前是元信息（由
 * CLI 参数入库，不进正文），之后才是正文。没有分隔线就把标题行之后全当正文。
 */
function splitDoc(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const title = lines[0]?.startsWith('# ') ? lines[0].slice(2).trim() : null;
  const sep = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  const body = sep === -1 ? lines.slice(title ? 1 : 0) : lines.slice(sep + 1);
  return { title, body: body.join('\n').trim() };
}

/** 源文件路径存成仓库相对、正斜杠形式，跨平台看着一致 */
function relSource(src) {
  return path.relative(process.cwd(), path.resolve(src)).replace(/\\/g, '/');
}

function parseFields(list, forceSecret = false) {
  return list
    .map((s) => {
      const idx = String(s).indexOf('=');
      if (idx === -1) return null;
      const label = s.slice(0, idx).trim();
      return {
        label,
        value: s.slice(idx + 1).trim(),
        // 网址、登入名称这类照常显示，只有密码类和证件号码类才打码，
        // 否则整条卡片全是圆点，反而难用
        secret: forceSecret || SECRET_LABEL.test(label) || SECRET_ID_LABEL.test(label),
      };
    })
    .filter(Boolean);
}

async function ingestFile(src) {
  const s = await stat(src);
  const now = new Date();
  const bucket = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await mkdir(path.join(UPLOAD_DIR, bucket), { recursive: true });

  // --name 可以给文件一个规范名字（上传来的文件名往往带随机前缀），
  // 没写扩展名就沿用原文件的
  let raw = path.basename(src);
  if (typeof flags.name === 'string' && flags.name.trim()) {
    const given = flags.name.trim();
    raw = path.extname(given) ? given : given + path.extname(src);
  }
  const base = raw.replace(/[\\/:*?"<>|]/g, '_');
  const stored = path.join(bucket, `${randomUUID().slice(0, 8)}-${base}`);
  await copyFile(src, path.join(UPLOAD_DIR, stored));

  return {
    filename: base,
    storedPath: stored.replace(/\\/g, '/'),
    mimeType: MIME[path.extname(base).toLowerCase()] ?? 'application/octet-stream',
    size: s.size,
  };
}

Object.assign(
  commands,
  healthCommands({ db, positional, flags, money, line, ingestFile })
);

Object.assign(commands, policyCommands({ db, positional, flags, line }));

// ---------- 执行 ----------
const run = commands[cmd] ?? commands.help;
try {
  await run();
  const ignored = Object.keys(rawFlags).filter((k) => !usedFlags.has(k));
  if (ignored.length && cmd !== 'help') {
    console.error(
      `
⚠ 这些参数 ${cmd} 没读：${ignored.map((k) => '--' + k).join(' ')}` +
      `
  ⚠ 命令**已经执行完了**（该建的已经建了、该改的已经改了），只是这个参数被丢掉。
  别当成失败重跑一遍 —— 会多出一条。补的话用 task:update / vault:update 之类改回来。`
    );
    process.exitCode = 1; // 让 `cmd && next` 这种链子停下来，不至于悄悄往下走
  }
} catch (e) {
  console.error('出错:', e.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
