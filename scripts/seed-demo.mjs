#!/usr/bin/env node
/**
 * 往库里灌一批**假数据**，用来看 UI、给人演示。
 *
 *   node scripts/seed-demo.mjs          # 追加
 *   node scripts/seed-demo.mjs --reset  # 先清空再灌（连 uploads/demo/ 一起）
 *
 * 为什么要有它：空列表看不出布局好不好，更看不出这软件能干什么。
 * 目标是**每个栏目点进去都有东西**，而且是一眼能看懂用途的东西：
 *
 *   对话  20+ 条往来，带表格和清单（顺带演示 Markdown 渲染）
 *   任务  16 条跨状态跨到期日，其中一条有完整多轮时间线 + 附件 + 前置依赖
 *   资料  12 条跨 8 个分类，含敏感项（打码）和挂着原件的
 *   财务  3 个月月结单、60 笔交易，看得出趋势和分类
 *   健康  4 位家庭成员、3 份体检报告、38 项指标（含异常）
 *   专题  4 个，其中一个带 HTML 呈现页
 *   文件  11 个**真写到磁盘**的文件（点得开），跨 6 个分类
 *   保险  5 张保单 + 缴费记录
 *   文稿  4 篇（话术、操作指引、调研任务书、简报），其中三篇挂在任务上
 *
 * ⚠ **里面所有号码都是编的**，卡号、证件号、保单号一律不是真的，
 * 而且刻意写得一眼能看出是假的（尾号 0000、手机号 138-0000-xxxx、
 * 保单号 DEMO-xxxx）。这个脚本可能跑在测试实例上，假数据必须假得明显，
 * 免得哪天分不清哪条是真的。
 *
 * 别在装着真实数据的库上跑 `--reset`。
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

try {
  process.loadEnvFile();
} catch {
  // 用系统环境变量
}

const db = new PrismaClient();
const RESET = process.argv.includes('--reset');
const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';
/** 演示文件全部落在这一个桶里，--reset 时整桶删掉，不会误伤真实上传 */
const BUCKET = 'demo';

/** n 天前 / 后 */
const day = (n) => new Date(Date.now() + n * 86400000);
const yuan = (n) => Math.round(n * 100);
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// ─────────────────────────────────────────────────────────────
// 真实文件：文件页上点得开才算数
//
// 不放几张样图进仓库，是想让这个脚本自给自足 —— 演示数据不该依赖
// 仓库里躺着一堆二进制。PNG 和 PDF 都是现生成的。
// ─────────────────────────────────────────────────────────────

/** CRC32，PNG 每个块都要带一个 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 生成一张带对角线的纯色 PNG（纯色的缩略图看着像坏图） */
function makePng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // 颜色类型：真彩
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0; // 滤波器：无
    for (let x = 0; x < w; x++) {
      const on = Math.abs(x - y) < 3;
      raw[off + 1 + x * 3] = on ? 255 : r;
      raw[off + 2 + x * 3] = on ? 255 : g;
      raw[off + 3 + x * 3] = on ? 255 : b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 生成一份能真打开的单页 PDF。
 *
 * 偏移量是算出来的不是抄来的 —— 手写 xref 差一个字节，阅读器就报文件损坏。
 * 正文只用 ASCII：内置的 Helvetica 没有中文字形，塞中文进去是一页方块。
 * 文件名可以是中文，那个不受字体限制。
 */
function makePdf(lines) {
  const content =
    'BT /F1 14 Tf 60 780 Td 18 TL\n' +
    lines.map((l) => `(${l.replace(/([()\\])/g, '\\$1')}) Tj T*`).join('\n') +
    '\nET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (out += String(o).padStart(10, '0') + ' 00000 n \n'));
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** 写一个演示文件到 uploads/demo/，返回 Attachment 需要的四个字段 */
function putFile(name, buf, mimeType) {
  const dir = path.join(UPLOAD_DIR, BUCKET);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), buf);
  return { filename: name, storedPath: `${BUCKET}/${name}`, mimeType, size: buf.length };
}

// ─────────────────────────────────────────────────────────────

async function main() {
  if (RESET) {
    console.log('清空…');
    // 顺序要紧：有外键的先删。
    await db.policyPayment.deleteMany();
    await db.policy.deleteMany();
    await db.transaction.deleteMany();
    await db.statement.deleteMany();
    await db.healthMetric.deleteMany();
    await db.healthReport.deleteMany();
    await db.member.deleteMany();
    await db.attachment.deleteMany();
    await db.message.deleteMany();
    await db.chatSummary.deleteMany();
    await db.conversation.deleteMany();
    await db.pageVersion.deleteMany();
    await db.page.deleteMany();
    // 示例页面跟着页面一起清了，标记也得清，下次起服务才会重新放上
    await db.setting.deleteMany({ where: { key: 'seeded.samplePages' } });
    // 演示数据里的任务派给「本人」「妻子」，名单得对上，下拉里才有这两个人
    await db.setting.upsert({
      where: { key: 'owners' },
      create: { key: 'owners', value: JSON.stringify(['本人', '妻子']) },
      update: { value: JSON.stringify(['本人', '妻子']) },
    });
    // 任务之间有 blocksOn 自引用，先解开再删
    await db.task.updateMany({ data: { blocksOn: null, docId: null, topicId: null } });
    await db.task.deleteMany();
    await db.vaultItem.deleteMany();
    await db.document.deleteMany();
    await db.topic.deleteMany();
    const demoDir = path.join(UPLOAD_DIR, BUCKET);
    if (existsSync(demoDir)) rmSync(demoDir, { recursive: true, force: true });
  }

  // ══════════ 文稿 ══════════
  const docHuashu = await db.document.create({
    data: {
      title: '给保险公司打电话的话术',
      category: '话术',
      summary: '问续保、问理赔进度时照着念，三段话把该问的问全',
      occasion: '车险到期前',
      date: day(-20),
      tags: '保险,电话',
      body: `# 给保险公司打电话的话术

打之前先把**保单号**和**投保人身份证号**放手边，客服第一句就会问。

## 一、确认身份和保单

> 你好，我要查一份车险，保单号 DEMO-0000-0002，投保人是我本人。

## 二、问清楚四件事

一件一件问，别让对方一口气报个总价就挂了：

1. **今年的续保报价是多少**，跟去年比涨了还是降了
2. **涨的部分是因为什么** —— 出险记录？车龄？条款调整？
3. **有没有别的渠道更便宜**（官网 / 支付宝 / 4S 店），价差多少
4. **这个价格能锁多久**，我考虑两天再定行不行

## 三、留证据

> 麻烦把刚才这个报价发我短信或者微信，我要留个记录。

**口头报价不算数。** 上次就是电话里说 3600，出单变成 3860，
对方说「那是没算上不计免赔」。有书面的就不会有这种事。

---

⚠ 这是演示数据，里面的保单号和金额都是编的。`,
    },
  });

  const docZhinan = await db.document.create({
    data: {
      title: '医保异地就医备案怎么办',
      category: '操作指引',
      summary: '手机上五步办完，不用跑医保局',
      date: day(-45),
      tags: '医保,健康',
      body: `# 医保异地就医备案怎么办

**能在手机上办完，不用跑医保局。** 办完之后在外地住院可以直接刷卡结算，
不用先垫钱再回来报销。

## 步骤

1. 打开「国家医保服务平台」App，首页 → **异地就医**
2. 选 **异地就医备案** → 备案人选自己（给家人办就选家庭成员）
3. 备案类型：
   - 长期在外地住 → **异地长期居住**
   - 只是去看个病 → **异地转诊** 或 **异地急诊**
4. 填就医地（选到市）、备案原因、起止时间
5. 提交，一般 **1-3 个工作日**出结果，App 里能看进度

## 几个容易卡住的地方

| 卡在哪 | 怎么办 |
| --- | --- |
| 找不到「家庭成员」 | 先在「我的 → 家庭成员」里添加，要对方的身份证号 |
| 备案类型选错 | 备案成功后可以撤销重办，但要等原备案过期或手动撤销 |
| 提示「参保地不支持线上办理」 | 只能打参保地医保局电话，或让家人代办 |

## 办完之后

住院时**主动告诉医院「我做了异地备案」**，否则医院可能仍按自费走。
出院结算单上要能看到「医保统筹支付」这一栏，看不到就是没走上。

---

⚠ 这是演示数据。真要办以当地医保局的说法为准。`,
    },
  });

  const docDiaoyan = await db.document.create({
    data: {
      title: '装修公司比价 —— 调研任务书',
      category: '调研任务书',
      summary: '整段复制给做调研的 AI，回来一份成都本地半包行情',
      date: day(-8),
      tags: '装修,调研',
      body: `# 调研任务书：成都半包装修行情

## 背景

一套 89㎡ 两居，2019 年交付的商品房，现在要做局部翻新
（厨卫防水重做、全屋电路换线、墙面重刷）。**不动格局，不拆承重。**

## 要你回答的问题

1. 2026 年成都半包（人工 + 辅料）每平米大致什么价位？区间是多少？
2. 这三项分别在总价里占多少比例？哪一项最容易被加价？
3. 报价单上**哪些项目是常见的坑**（比如「材料损耗」按多少算合理）？
4. 半包 / 全包 / 清包，对我这种情况哪个更合适，为什么？

## 不要回答的

- 不要推荐具体公司或师傅 —— 那个我自己问本地人
- 不要给全国平均数 —— 只要成都

## 交付格式

一份 Markdown，**每个数字都要带来源和时间**。没把握的地方明说「不确定」，
不要给一个看起来很确定的数字。

---

⚠ 这是演示数据。`,
    },
  });

  const docJianbao = await db.document.create({
    data: {
      title: '这个季度的钱花到哪了',
      category: '简报',
      summary: '三个月账单看下来的四条结论',
      date: day(-2),
      tags: '财务',
      body: `# 这个季度的钱花到哪了

三个月账单导完了，**真实支出**（已剔除理财来回、报销垫付这类「钱在自己口袋之间挪」的）：

| 月份 | 真实支出 | 比上月 |
| --- | ---: | --- |
| 第一个月 | ¥14,280 | — |
| 第二个月 | ¥16,940 | ↑ 19% |
| 第三个月 | ¥13,810 | ↓ 19% |

## 四条结论

1. **中间那一笔跳涨是培训班**，一次交了两个季度 ¥4,800。摊到两个季度看，
   三个月其实是平的。
2. **固定支出占 62%**（房贷 6,820 + 物业 + 水电气网 + 手机），这部分压不动。
3. **餐饮三个月 ¥3,180**，其中外卖 ¥1,240。这是唯一有明显压缩空间的一项。
4. **医疗支出在涨**：¥156 → ¥476。都是妈妈的降压药和门诊，
   建议单独盯一下，看是不是该调整用药方案。

## 下个月要注意

- **10/08 车险到期**，去年 ¥3,860，今年要问清楚涨没涨（话术见任务上挂的那份文稿）
- 宽带 11/30 到期，现在这家一年 ¥1,280，可以趁续费谈一次

---

⚠ 这是演示数据，金额全是编的。`,
    },
  });

  // ══════════ 专题 ══════════
  const topicNet = await db.topic.create({
    data: {
      title: '换宽带套餐',
      category: '生活',
      status: 'active',
      summary: '现在 200M 一年 1280，想换 500M，问了三家还没定',
      body: `现在用的是移动 200M，一年 ¥1,280，**11/30 到期**。

家里两个人在家办公，晚上视频会议偶尔卡，想升到 500M。
问了三家，价差没想象中大，但「首年优惠价」这个坑各家都有。

下一步：等移动的客服把第二年的价格给个书面答复，再定。`,
      // 呈现页存数据库不走附件 —— 改一次就是 UPDATE，地址固定成 /topics/<id>/page，
      // 可以加书签。走附件的话改一次多一条记录、换一个 id，书签就失效了。
      page: `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>宽带三家比价</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.7 system-ui, sans-serif; max-width: 46rem; margin: 0 auto; padding: 1.5rem; }
  h1 { font-size: 1.3rem; margin: 0 0 .25rem; }
  .sub { color: #888; font-size: .85rem; margin: 0 0 1.5rem; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: .9rem; }
  th, td { text-align: left; padding: .55rem .5rem; border-bottom: 1px solid #8883; }
  th { font-weight: 600; }
  .win { color: #16a34a; font-weight: 600; }
  .warn { color: #d97706; }
  .note { border-left: 3px solid #8884; padding-left: .9rem; margin: 1.5rem 0; color: #888; font-size: .88rem; }
  .demo { margin-top: 2rem; font-size: .8rem; color: #999; }
</style></head><body>
<h1>宽带三家比价</h1>
<p class="sub">问到 2026-09-20 · 现用移动 200M / 年费 ¥1,280 / 11-30 到期</p>

<table>
  <tr><th>运营商</th><th>带宽</th><th>首年</th><th>次年</th><th>要不要绑手机</th></tr>
  <tr><td>移动（现用）</td><td>500M</td><td>¥1,380</td><td class="warn">没给准话</td><td>不用</td></tr>
  <tr><td>电信</td><td>500M</td><td class="win">¥1,180</td><td>¥1,580</td><td>销售说不用，无书面</td></tr>
  <tr><td>联通</td><td>300M</td><td>¥980</td><td>¥1,280</td><td>要，月租 ¥59 起</td></tr>
</table>

<p><strong>看下来：</strong>电信首年最便宜，但次年 ¥1,580 比现在还贵 ¥300。
两年总价：电信 ¥2,760，移动（若次年不涨）¥2,760 —— <strong>打平</strong>。
所以关键就一件事：<strong>移动次年到底涨不涨。</strong></p>

<div class="note">
  三家销售都主动强调「首年优惠」，都不主动说次年。
  这不是巧合，是行业话术 —— 问价时必须追着问第二年。
</div>

<p class="demo">⚠ 这是演示数据，价格和条款都是编的。</p>
</body></html>`,
      questions: JSON.stringify([
        { q: '移动说的「首年优惠价」第二年涨到多少？', note: '客服没给准话，让等回电', done: false },
        { q: '现在这个合约提前解约有没有违约金？', note: '11/30 到期，提前换要问清', done: false },
        { q: '电信 500M 是不是必须绑手机套餐', note: '销售说不用，但没有书面的', done: true },
        { q: '联通 300M 够不够两个人同时视频会议', note: '实测邻居家 300M 够用', done: true },
      ]),
      tags: '生活,宽带',
    },
  });

  const topicCar = await db.topic.create({
    data: {
      title: '车子的事',
      category: '车辆',
      status: 'active',
      summary: '六年免检到期要上线检，车险 10/08 也到期，一起办',
      body: `两件事凑一块了：

- **年检**：六年免检期满，今年起要上线检测
- **车险**：10/08 到期，去年 ¥3,860

顺序上先问车险报价（要时间比价），年检随时能去。`,
      questions: JSON.stringify([
        { q: '成都哪个检测站周末开？', done: false },
        { q: '年检前要不要先处理违章', note: '查了，有一条 6 月的未处理', done: true },
      ]),
      tags: '车辆',
    },
  });

  const topicMom = await db.topic.create({
    data: {
      title: '妈妈的高血压',
      category: '健康',
      status: 'active',
      summary: '换药第二个月，血压稳住了，三个月后复查',
      body: `体检发现血压控制不好（158/96），医生换了药。

现在早晚各测一次，**连续两周平均 132/84**，比之前好很多。

医生说三个月后复查，顺便查一次肾功能 —— 长期吃降压药要盯这个。`,
      questions: JSON.stringify([
        { q: '新药有没有副作用要盯的', note: '医生说主要看肾功能和血钾', done: true },
        { q: '复查要不要空腹', done: false },
        { q: '医保能不能报这个药', note: '在乙类目录里，自付 20%', done: true },
      ]),
      tags: '健康,妈妈',
    },
  });

  const topicHome = await db.topic.create({
    data: {
      title: '厨卫翻新',
      category: '居家',
      status: 'parked',
      summary: '报价拿了两家，差得太多，先搁着等调研结果',
      body: `厨卫防水重做 + 全屋换线 + 墙面重刷，**不动格局**。

两家报价：¥68,000 和 ¥41,000，差 ¥27,000。差这么多说明我不懂行情，
已经派了一份调研任务书出去，等回来再比。

**先搁置**，不急。`,
      questions: JSON.stringify([
        { q: '成都半包每平米什么价位算合理', note: '调研任务书已发出', done: false },
        { q: '防水要不要做闭水试验，谁出钱', done: false },
        { q: '老房换线要不要开槽，会不会动到承重', note: '物业说非承重墙可开', done: true },
      ]),
      tags: '居家,装修',
    },
  });

  // ══════════ 任务 ══════════
  // 先建被依赖的那条，后面才引用得到
  const taskQuote = await db.task.create({
    data: {
      title: '找三家装修公司要报价',
      detail: '厨卫防水 + 全屋电路 + 墙面。要书面报价单，不要口头数字。',
      category: '居家',
      status: 'doing',
      priority: 2,
      owner: '本人',
      dueDate: day(6),
      topicId: topicHome.id,
      docId: docDiaoyan.id,
    },
  });

  const taskInsurance = await db.task.create({
    data: {
      title: '车险 10/08 到期，比三家价再定',
      detail: `去年 ¥3,860（交强 + 商业）。今年要问清楚：

1. 报价涨了没有，涨的原因是什么
2. 官网 / 支付宝 / 4S 店哪个便宜
3. 报价要书面的，口头的不算

⚠ 上次就是电话里说 3,600，出单变成 3,860。`,
      category: '保险',
      status: 'doing',
      priority: 1,
      owner: '本人',
      dueDate: day(14),
      topicId: topicCar.id,
      docId: docHuashu.id,
    },
  });

  const rest = [
    { title: '交物业费', category: '居家', status: 'todo', dueDate: day(3), priority: 1, owner: '本人', detail: '一季度一交，去年是 ¥1,860。物业群里说今年没涨。' },
    { title: '社保卡换新', category: '证件', status: 'todo', dueDate: day(-2), priority: 1, owner: '本人', detail: '旧卡磁条坏了。上次去银行说要带身份证原件，还要本人到场。' },
    { title: '陪妈妈复查血压', category: '健康', status: 'todo', dueDate: day(78), priority: 2, owner: '本人', topicId: topicMom.id, detail: '医生说三个月后复查，顺便查肾功能和血钾。要带上早晚血压记录。' },
    { title: '换宽带套餐', category: '生活', status: 'doing', dueDate: day(20), priority: 2, owner: '本人', topicId: topicNet.id, detail: '等移动客服回电，给次年价格的书面答复。' },
    { title: '车子年检', category: '车辆', status: 'todo', dueDate: day(40), priority: 2, owner: '妻子', topicId: topicCar.id },
    { title: '女儿秋季校服尺码', category: '教育', status: 'todo', dueDate: day(9), priority: 2, owner: '妻子', detail: '学校群里发了尺码表，10 号前回复班主任。' },
    { title: '给妈妈约口腔科', category: '健康', status: 'todo', dueDate: day(25), priority: 3, owner: '妻子' },
    { title: '续域名', category: '其他', status: 'todo', dueDate: day(88), priority: 3 },
    { title: '医保异地备案', category: '健康', status: 'done', priority: 2, owner: '本人', docId: docZhinan.id, result: '已备案，本月 18 号通过。App 里能查到，有效期一年。' },
    { title: '报销上个月差旅', category: '工作', status: 'done', priority: 3, owner: '本人', result: '已报，到账 ¥2,340。' },
    { title: '给妈妈买降压药', category: '健康', status: 'done', priority: 2, owner: '本人', topicId: topicMom.id, result: '买了三个月的量，¥156。医保乙类，自付 20%。' },
    { title: '把这季度账单导进来', category: '财务', status: 'done', priority: 2, owner: '本人', docId: docJianbao.id, result: '三个月导完，勾稽都过了。小结见文稿页。' },
    { title: '换车位', category: '居家', status: 'cancelled', priority: 3, result: '物业说没有空位了，排队要两年。先算了。' },
    { title: '装修签合同', category: '居家', status: 'todo', dueDate: day(30), priority: 2, owner: '本人', topicId: topicHome.id, blocksOn: taskQuote.id, detail: '三家报价都拿到、调研结果回来之后再签。' },
  ];
  for (const t of rest) await db.task.create({ data: t });

  // ── 多轮时间线：详情页的看点都在这一条上 ──
  const quoteA = putFile(
    '装修报价单-甲方案.pdf',
    makePdf([
      'DEMO QUOTE A - NOT A REAL DOCUMENT',
      '',
      'Renovation, 89 sqm, semi-package',
      '',
      'Waterproofing        CNY 12,800',
      'Rewiring             CNY 18,600',
      'Wall repainting      CNY  9,400',
      'Management fee       CNY 12,000',
      'Material loss        CNY 15,200',
      '--------------------------------',
      'Total                CNY 68,000',
      '',
      'Generated by seed-demo.mjs',
    ]),
    'application/pdf'
  );

  await db.message.create({
    data: {
      role: 'user', sender: '本人', status: 'handled', taskId: taskQuote.id, createdAt: day(-7),
      content: '第一家报了 6.8 万，第二家 4.1 万。差这么多是不是有问题？',
    },
  });
  await db.message.create({
    data: {
      role: 'secretary', status: 'read', taskId: taskQuote.id, createdAt: day(-7),
      content: `差 2.7 万不算离谱，但**差在哪必须问清楚**。两份报价单拉平对了一遍：

| 项目 | 甲方案 | 乙方案 | 差额 |
| --- | ---: | ---: | ---: |
| 防水 | ¥12,800 | ¥8,200 | 4,600 |
| 电路 | ¥18,600 | ¥11,400 | 7,200 |
| 墙面 | ¥9,400 | ¥6,800 | 2,600 |
| 管理费 | ¥12,000 | ¥3,600 | 8,400 |
| 材料损耗 | ¥15,200 | ¥11,000 | 4,200 |

**两个地方值得追问：**

1. **管理费差 8,400** —— 甲按总价 18% 收，乙按 8%。这一项没有行规，纯看谈。
   光这一项就占了总差额三分之一。
2. **电路差 7,200** —— 要问清是不是同样的线材规格（2.5 还是 4 平方）、
   是不是都含开槽和修补。这一项最容易靠「不含」做低价格。

防水那 4,600 反而正常，多半是材料品牌不同。

⚠ **别只看总价选人。** 调研任务书已经挂在这条任务上了，
等成都的行情数据回来，再决定哪一家的价格是合理的。`,
    },
  });
  const msgWithFile = await db.message.create({
    data: {
      role: 'user', sender: '本人', status: 'pending', taskId: taskQuote.id, createdAt: day(-1),
      content: '甲方案的报价单我拍下来了，你看看还有没有别的坑。',
    },
  });
  await db.attachment.create({
    data: {
      ...quoteA, category: '合同', note: '甲方案报价单（演示数据）',
      uploadedBy: 'user', messageId: msgWithFile.id, taskId: taskQuote.id, createdAt: day(-1),
    },
  });

  // 车险那条也来两轮，列表上才会出现「管家回了」这个信号
  await db.message.create({
    data: {
      role: 'user', sender: '本人', status: 'handled', taskId: taskInsurance.id, createdAt: day(-3),
      content: '打了电话，报价 4,120，比去年贵了 260。',
    },
  });
  await db.message.create({
    data: {
      role: 'secretary', status: 'unread', taskId: taskInsurance.id, createdAt: day(-2),
      content: `贵 ¥260（涨 6.7%）。**先别急着答应。**

去年到今年你没出过险，交强险应该往下走才对 —— 连续三年无理赔最多能降 30%。
所以涨价只可能来自商业险那一半，得让他们拆开报：

- 交强险多少（国家定价，有固定折扣表，可以自己核）
- 商业险多少，涨的是哪个险种

另外**支付宝和官网通常比电话渠道便宜 5-10%**，值得花十分钟比一下。

话术更新了，挂在这条任务上，照着问就行。`,
    },
  });

  // ══════════ 资料库 ══════════
  const vault = [
    {
      category: '银行', title: '招商银行储蓄卡', sensitive: true, tags: '本人,工资卡',
      fields: JSON.stringify([
        { label: '卡号', value: '6225 8800 0000 0000' },
        { label: '开户行', value: '成都高新支行' },
        { label: '预留手机', value: '138 0000 0000' },
        { label: '取款密码', value: 'demo-not-real', secret: true },
      ]),
      notes: '工资卡，房贷也从这张扣。月结单每月 5 号出。',
    },
    {
      category: '银行', title: '建设银行储蓄卡', tags: '妻子',
      fields: JSON.stringify([
        { label: '卡号', value: '6217 0000 0000 0000' },
        { label: '开户行', value: '成都锦江支行' },
      ]),
      notes: '女儿学费从这张扣',
    },
    {
      category: '证件', title: '身份证（本人）', sensitive: true, tags: '本人',
      fields: JSON.stringify([
        { label: '号码', value: '510100 1990 0101 0000' },
        { label: '签发机关', value: '成都市公安局高新分局' },
        { label: '有效期至', value: '2032-01-01' },
      ]),
    },
    {
      category: '证件', title: '护照（本人）', sensitive: true, tags: '本人,出行',
      fields: JSON.stringify([
        { label: '号码', value: 'E00000000' },
        { label: '签发地', value: '四川' },
        { label: '有效期至', value: '2029-06-15' },
      ]),
      notes: '出国前记得看还剩不剩六个月有效期',
    },
    {
      category: '网络', title: '家里 WiFi', tags: '家',
      fields: JSON.stringify([
        { label: '名称', value: 'Home-5G' },
        { label: '密码', value: 'demo-not-real', secret: true },
        { label: '路由器后台', value: '192.168.1.1' },
        { label: '后台密码', value: 'demo-not-real', secret: true },
      ]),
    },
    {
      category: '网络', title: '宽带账号', tags: '家',
      fields: JSON.stringify([
        { label: '宽带账号', value: 'cd00000000' },
        { label: '密码', value: 'demo-not-real', secret: true },
        { label: '到期', value: '2026-11-30' },
        { label: '客服', value: '10086' },
      ]),
      notes: '移动 200M，一年 ¥1,280。到期前一个月可以谈价。',
    },
    {
      category: '车辆', title: '车辆信息', tags: '本人',
      fields: JSON.stringify([
        { label: '车牌', value: '川A·00000' },
        { label: '车架号', value: 'LSV00000000000000' },
        { label: '发动机号', value: '000000' },
        { label: '购车日期', value: '2019-04-18' },
      ]),
      notes: '2019 年车，六年免检已满，今年起要上线检',
    },
    {
      category: '医疗', title: '社保卡（本人）', sensitive: true, tags: '本人',
      fields: JSON.stringify([
        { label: '卡号', value: '5101 0000 0000' },
        { label: '服务银行', value: '成都农商行' },
        { label: '密码', value: 'demo-not-real', secret: true },
      ]),
      notes: '磁条坏了，要换新卡',
    },
    {
      category: '医疗', title: '妈妈的就诊信息', tags: '妈妈',
      fields: JSON.stringify([
        { label: '医保卡号', value: '5101 0000 0001' },
        { label: '常去医院', value: '省人民医院 · 心内科' },
        { label: '主治医生', value: '王医生（周二、周四上午门诊）' },
        { label: '在吃的药', value: '苯磺酸氨氯地平片 5mg 每日一次' },
      ]),
      notes: '高血压，两个月前换的药',
    },
    {
      category: '教育', title: '女儿学校账号', tags: '女儿',
      fields: JSON.stringify([
        { label: '学号', value: '2026000000' },
        { label: '班级', value: '三年级二班' },
        { label: '班主任', value: '李老师 138 0000 0001' },
        { label: '校园网密码', value: 'demo-not-real', secret: true },
      ]),
    },
    {
      category: '住房', title: '房产信息', sensitive: true, tags: '本人,妻子',
      fields: JSON.stringify([
        { label: '产权证号', value: '川(2019)成都市不动产权第0000000号' },
        { label: '面积', value: '89.4 ㎡' },
        { label: '房贷银行', value: '招商银行' },
        { label: '月供', value: '¥6,820' },
        { label: '还剩', value: '18 年' },
      ]),
    },
    {
      category: '其他', title: '常用会员卡', tags: '家',
      fields: JSON.stringify([
        { label: '天府通', value: '0000 0000' },
        { label: '超市会员', value: '138 0000 0000（手机号即会员号）' },
        { label: '图书馆借书证', value: 'CD00000000' },
      ]),
    },
  ];
  const vaultItems = [];
  for (const v of vault) vaultItems.push(await db.vaultItem.create({ data: v }));

  // ══════════ 财务：三个月 ══════════
  const MONTHS = [
    {
      back: 2,
      txs: [
        ['工资', 'credit', 18500, '工资', '某某科技'],
        ['房贷', 'debit', 6820, '住房', '招商银行'],
        ['物业费', 'debit', 620, '住房', '某某物业'],
        ['超市', 'debit', 486.3, '日用', '永辉超市'],
        ['超市', 'debit', 312.8, '日用', '盒马'],
        ['加油', 'debit', 400, '交通', '中石化'],
        ['天府通充值', 'debit', 100, '交通', '天府通'],
        ['外卖', 'debit', 58.6, '餐饮', '美团'],
        ['外卖', 'debit', 43.2, '餐饮', '饿了么'],
        ['聚餐', 'debit', 428, '餐饮', '某某火锅'],
        ['电费', 'debit', 286.4, '水电', '国网四川'],
        ['水费', 'debit', 58.6, '水电', '成都自来水'],
        ['燃气费', 'debit', 42, '水电', '成都燃气'],
        ['手机费', 'debit', 59, '通讯', '中国移动'],
        ['药店', 'debit', 156.4, '医疗', '某某大药房'],
        ['孩子培训班', 'debit', 2400, '教育', '某某教育'],
        ['买衣服', 'debit', 399, '服饰', '优衣库'],
        ['电影', 'debit', 96, '娱乐', '万达影城'],
        ['理财赎回', 'credit', 5000, 'self_transfer', '招商银行'],
        ['转出到余额宝', 'debit', 5000, 'self_transfer', '支付宝'],
      ],
    },
    {
      back: 1,
      txs: [
        ['工资', 'credit', 18500, '工资', '某某科技'],
        ['房贷', 'debit', 6820, '住房', '招商银行'],
        ['超市', 'debit', 521.4, '日用', '永辉超市'],
        ['超市', 'debit', 288.9, '日用', '盒马'],
        ['加油', 'debit', 400, '交通', '中石化'],
        ['停车费', 'debit', 180, '交通', '某某停车场'],
        ['外卖', 'debit', 62.8, '餐饮', '美团'],
        ['外卖', 'debit', 88.4, '餐饮', '饿了么'],
        ['聚餐', 'debit', 386, '餐饮', '某某火锅'],
        ['电费', 'debit', 412.6, '水电', '国网四川'],
        ['水费', 'debit', 64.2, '水电', '成都自来水'],
        ['燃气费', 'debit', 38, '水电', '成都燃气'],
        ['手机费', 'debit', 59, '通讯', '中国移动'],
        ['门诊', 'debit', 320, '医疗', '省人民医院'],
        ['药店', 'debit', 212.6, '医疗', '某某大药房'],
        ['孩子培训班', 'debit', 4800, '教育', '某某教育'],
        ['校服', 'debit', 320, '教育', '某某校服'],
        ['买鞋', 'debit', 699, '服饰', '迪卡侬'],
        ['报销到账', 'credit', 2340, 'pass_through', '公司'],
        ['垫付同事聚餐', 'debit', 600, 'pass_through', '某某餐厅'],
        ['同事还钱', 'credit', 600, 'pass_through', '微信转账'],
      ],
    },
    {
      back: 0,
      txs: [
        ['工资', 'credit', 18500, '工资', '某某科技'],
        ['房贷', 'debit', 6820, '住房', '招商银行'],
        ['物业费', 'debit', 620, '住房', '某某物业'],
        ['超市', 'debit', 432.5, '日用', '永辉超市'],
        ['超市', 'debit', 276.4, '日用', '盒马'],
        ['加油', 'debit', 400, '交通', '中石化'],
        ['地铁公交', 'debit', 128, '交通', '天府通'],
        ['外卖', 'debit', 62.8, '餐饮', '美团'],
        ['外卖', 'debit', 48, '餐饮', '饿了么'],
        ['聚餐', 'debit', 286, '餐饮', '某某烧烤'],
        ['电费', 'debit', 218.6, '水电', '国网四川'],
        ['水费', 'debit', 61.8, '水电', '成都自来水'],
        ['燃气费', 'debit', 88, '水电', '成都燃气'],
        ['手机费', 'debit', 59, '通讯', '中国移动'],
        ['宽带续费', 'debit', 1280, '通讯', '中国移动'],
        ['药店', 'debit', 156.4, '医疗', '某某大药房'],
        ['门诊', 'debit', 320, '医疗', '省人民医院'],
        ['理发', 'debit', 68, '日用', '某某理发店'],
        ['理财赎回', 'credit', 3000, 'self_transfer', '招商银行'],
        ['转出到余额宝', 'debit', 3000, 'self_transfer', '支付宝'],
      ],
    },
  ];

  let balance = yuan(42800);
  const statements = [];
  for (const mo of MONTHS) {
    const monthDate = new Date();
    monthDate.setDate(1);
    monthDate.setMonth(monthDate.getMonth() - mo.back);
    const debit = mo.txs.filter((t) => t[1] === 'debit').reduce((s, t) => s + yuan(t[2]), 0);
    const credit = mo.txs.filter((t) => t[1] === 'credit').reduce((s, t) => s + yuan(t[2]), 0);
    const opening = balance;
    const closing = opening + credit - debit;

    const stmt = await db.statement.create({
      data: {
        bank: '招商银行',
        account: 'main',
        period: ym(monthDate),
        statementDate: new Date(monthDate.getFullYear(), monthDate.getMonth(), 5),
        openingTotalCents: opening,
        // 期初 + 收 − 支 = 期末，一分不差。
        // **演示数据也要过勾稽** —— 演示时被自己的校验红字打脸就难看了。
        closingTotalCents: closing,
        closingBalanceCents: closing,
        note: '演示数据',
      },
    });
    statements.push(stmt);

    let run = opening;
    let d = 1;
    for (const [label, direction, amount, category, counterparty] of mo.txs) {
      const cents = yuan(amount);
      run += direction === 'credit' ? cents : -cents;
      await db.transaction.create({
        data: {
          statementId: stmt.id,
          date: new Date(monthDate.getFullYear(), monthDate.getMonth(), Math.min(28, d)),
          direction,
          amountCents: cents,
          baseCents: cents,
          balanceCents: run,
          currency: 'CNY',
          category,
          label,
          counterparty,
        },
      });
      d += 1 + (d % 2);
    }
    balance = closing;
  }

  // ══════════ 健康 ══════════
  const me = await db.member.create({
    data: { name: '本人', relation: 'self', gender: 'male', birthDate: new Date('1990-01-01'), heightCm: 175, weightKg: 72, sort: 0 },
  });
  const wife = await db.member.create({
    data: { name: '妻子', relation: 'spouse', gender: 'female', birthDate: new Date('1991-08-12'), heightCm: 163, weightKg: 54, sort: 1 },
  });
  const mom = await db.member.create({
    data: { name: '妈妈', relation: 'mother', gender: 'female', birthDate: new Date('1962-05-20'), heightCm: 158, weightKg: 62, chronicDiseases: '高血压', sort: 2 },
  });
  await db.member.create({
    data: { name: '女儿', relation: 'child', gender: 'female', birthDate: new Date('2017-03-08'), heightCm: 132, weightKg: 28, sort: 3 },
  });

  const reportMe = await db.healthReport.create({
    data: {
      memberId: me.id,
      title: `${new Date().getFullYear()} 年常规体检`,
      checkDate: day(-40),
      institution: '某某体检中心',
      summary: '总体正常。血脂偏高、尿酸偏高、轻度脂肪肝，建议控制饮食三个月后复查。',
      notes: '医生口头说：先不吃药，先管住嘴。少喝啤酒，海鲜和动物内脏减量。',
    },
  });
  const reportMom = await db.healthReport.create({
    data: {
      memberId: mom.id,
      title: '高血压复诊',
      checkDate: day(-65),
      institution: '省人民医院 · 心内科',
      summary: '血压控制不理想（158/96），调整用药。肾功能正常，可以继续观察。',
      notes: '换成苯磺酸氨氯地平片 5mg 每日一次。三个月后复查，要带上早晚血压记录。',
    },
  });
  const reportWife = await db.healthReport.create({
    data: {
      memberId: wife.id,
      title: `${new Date().getFullYear()} 年单位体检`,
      checkDate: day(-150),
      institution: '某某体检中心',
      summary: '基本正常，轻度贫血，建议补铁后三个月复查。',
    },
  });

  const metrics = [
    [reportMe, [
      ['血常规', '白细胞', '6.2', 6.2, '10^9/L', '3.5-9.5', 'normal'],
      ['血常规', '血红蛋白', '152', 152, 'g/L', '130-175', 'normal'],
      ['血常规', '血小板', '210', 210, '10^9/L', '125-350', 'normal'],
      ['血脂', '总胆固醇', '6.12', 6.12, 'mmol/L', '<5.18', 'high'],
      ['血脂', '甘油三酯', '2.41', 2.41, 'mmol/L', '<1.70', 'high'],
      ['血脂', '高密度脂蛋白', '1.05', 1.05, 'mmol/L', '>1.04', 'normal'],
      ['血脂', '低密度脂蛋白', '3.98', 3.98, 'mmol/L', '<3.37', 'high'],
      ['肝功', '谷丙转氨酶', '48', 48, 'U/L', '9-50', 'normal'],
      ['肝功', '谷草转氨酶', '31', 31, 'U/L', '15-40', 'normal'],
      ['肝功', '总胆红素', '14.2', 14.2, 'umol/L', '5-21', 'normal'],
      ['血糖', '空腹血糖', '5.4', 5.4, 'mmol/L', '3.9-6.1', 'normal'],
      ['肾功', '肌酐', '86', 86, 'umol/L', '57-97', 'normal'],
      ['肾功', '尿酸', '452', 452, 'umol/L', '208-428', 'high'],
      ['甲功', '促甲状腺激素', '2.1', 2.1, 'mIU/L', '0.27-4.2', 'normal'],
      ['影像', '腹部彩超', '轻度脂肪肝', null, null, null, 'attention'],
      ['影像', '胸部CT', '未见明显异常', null, null, null, 'normal'],
      ['体格', '血压', '128/84', null, 'mmHg', '<140/90', 'normal'],
      ['体格', 'BMI', '23.5', 23.5, null, '18.5-23.9', 'normal'],
    ]],
    [reportMom, [
      ['体格', '血压（诊室）', '158/96', null, 'mmHg', '<140/90', 'high'],
      ['体格', '心率', '78', 78, '次/分', '60-100', 'normal'],
      ['体格', 'BMI', '24.8', 24.8, null, '18.5-23.9', 'attention'],
      ['肾功', '肌酐', '68', 68, 'umol/L', '41-81', 'normal'],
      ['肾功', '尿素氮', '5.2', 5.2, 'mmol/L', '2.9-8.2', 'normal'],
      ['电解质', '血钾', '4.1', 4.1, 'mmol/L', '3.5-5.3', 'normal'],
      ['血脂', '总胆固醇', '5.42', 5.42, 'mmol/L', '<5.18', 'high'],
      ['血糖', '空腹血糖', '5.8', 5.8, 'mmol/L', '3.9-6.1', 'normal'],
      ['影像', '心电图', '窦性心律，大致正常', null, null, null, 'normal'],
      ['影像', '颈动脉彩超', '内膜稍增厚，未见斑块', null, null, null, 'attention'],
    ]],
    [reportWife, [
      ['血常规', '血红蛋白', '108', 108, 'g/L', '115-150', 'low'],
      ['血常规', '白细胞', '5.4', 5.4, '10^9/L', '3.5-9.5', 'normal'],
      ['血常规', '血小板', '246', 246, '10^9/L', '125-350', 'normal'],
      ['血脂', '总胆固醇', '4.32', 4.32, 'mmol/L', '<5.18', 'normal'],
      ['血糖', '空腹血糖', '4.9', 4.9, 'mmol/L', '3.9-6.1', 'normal'],
      ['甲功', '促甲状腺激素', '3.4', 3.4, 'mIU/L', '0.27-4.2', 'normal'],
      ['影像', '乳腺彩超', '未见明显异常', null, null, null, 'normal'],
      ['影像', '妇科彩超', '未见明显异常', null, null, null, 'normal'],
      ['体格', '血压', '112/70', null, 'mmHg', '<140/90', 'normal'],
      ['体格', 'BMI', '20.3', 20.3, null, '18.5-23.9', 'normal'],
    ]],
  ];
  for (const [report, list] of metrics) {
    for (const [category, name, value, numValue, unit, referenceRange, status] of list) {
      await db.healthMetric.create({
        data: { reportId: report.id, category, name, value, numValue, unit, referenceRange, status },
      });
    }
  }

  // ══════════ 保险 ══════════
  const Y = new Date().getFullYear();
  const policies = [
    {
      insured: '本人', relation: 'self', insurer: '某某人寿', product: '重疾险 A 款',
      policyNo: 'DEMO-0000-0001', kind: '重疾', region: 'cn', sumInsured: 500000,
      premiumCents: yuan(6800), premiumBaseCents: yuan(6800), currency: 'CNY',
      dueMonthDay: '03-15', coverStart: new Date(`${Y}-03-15`), coverEnd: new Date(`${Y + 25}-03-15`),
      firstIssued: new Date('2021-03-15'), guaranteed: true, guaranteedUntil: new Date(`${Y + 25}-03-15`),
      note: '交 20 年保至 70 岁',
    },
    {
      insured: '本人', relation: 'self', insurer: '某某财险', product: '车险（交强+商业）',
      policyNo: 'DEMO-0000-0002', kind: '车险', region: 'cn', sumInsured: 1000000,
      premiumCents: yuan(3860), premiumBaseCents: yuan(3860), currency: 'CNY',
      dueMonthDay: '10-08', coverStart: new Date(`${Y - 1}-10-08`), coverEnd: new Date(`${Y}-10-07`),
      firstIssued: new Date('2019-04-20'),
      note: '连续三年无理赔，续保时问清折扣',
    },
    {
      insured: '妈妈', relation: 'mother', insurer: '某某健康', product: '百万医疗',
      policyNo: 'DEMO-0000-0003', kind: '医疗', region: 'cn', sumInsured: 3000000,
      premiumCents: yuan(2180), premiumBaseCents: yuan(2180), currency: 'CNY',
      dueMonthDay: '06-01', coverStart: new Date(`${Y}-06-01`), coverEnd: new Date(`${Y + 1}-05-31`),
      firstIssued: new Date('2023-06-01'),
      note: '有高血压，投保时已告知，无加费',
    },
    {
      insured: '妻子', relation: 'spouse', insurer: '某某人寿', product: '定期寿险',
      policyNo: 'DEMO-0000-0004', kind: '寿险', region: 'cn', sumInsured: 1000000,
      premiumCents: yuan(1560), premiumBaseCents: yuan(1560), currency: 'CNY',
      dueMonthDay: '11-20', coverStart: new Date(`${Y - 1}-11-20`), coverEnd: new Date(`${Y + 29}-11-19`),
      firstIssued: new Date('2022-11-20'), guaranteed: true, guaranteedUntil: new Date(`${Y + 29}-11-19`),
    },
    {
      insured: '女儿', relation: 'child', insurer: '某某健康', product: '少儿医疗 + 意外',
      policyNo: 'DEMO-0000-0005', kind: '医疗', region: 'cn', sumInsured: 2000000,
      premiumCents: yuan(680), premiumBaseCents: yuan(680), currency: 'CNY',
      dueMonthDay: '09-01', coverStart: new Date(`${Y}-09-01`), coverEnd: new Date(`${Y + 1}-08-31`),
      firstIssued: new Date('2021-09-01'),
      note: '学平险之外另买的，覆盖校外意外',
    },
  ];
  for (const p of policies) {
    const created = await db.policy.create({ data: p });
    // 长期险多补几期已交记录，台账上才看得出「交到第几年」
    const years = created.guaranteed ? 3 : 1;
    for (let i = years; i >= 1; i--) {
      const dueOn = new Date(created.coverStart ?? day(-100));
      dueOn.setFullYear(dueOn.getFullYear() - (i - 1));
      if (dueOn > new Date()) continue;
      await db.policyPayment.create({
        data: {
          policyId: created.id,
          dueOn,
          paidOn: dueOn,
          amountCents: created.premiumCents,
          currency: 'CNY',
          baseCents: created.premiumBaseCents,
          note: '演示数据',
        },
      });
    }
  }

  // ══════════ 文件页：真写到磁盘，点得开 ══════════
  // note 里刻意塞了关键词 —— 全局搜索只搜文件名/分类/备注，**搜不到 PDF 和
  // HTML 的正文**。演示搜索功能时，能不能搜到全看这一行写没写。
  const files = [
    {
      ...putFile('招行月结单-演示.pdf', makePdf([
        'DEMO BANK STATEMENT - NOT REAL',
        '',
        'Account : **** **** **** 0000',
        'Period  : current month',
        'Opening : CNY 42,800.00',
        'Closing : CNY 48,161.90',
        '',
        'Generated by seed-demo.mjs',
      ]), 'application/pdf'),
      category: '账单', note: '招商银行月结单。关键词：月结单 流水 对账 招行',
      statementId: statements.at(-1)?.id,
    },
    {
      ...putFile('体检报告首页-演示.png', makePng(360, 260, [64, 92, 140]), 'image/png'),
      category: '医疗', note: '体检报告扫描件首页（演示占位图）。关键词：体检 血脂 尿酸 脂肪肝',
      healthReportId: reportMe.id,
    },
    {
      ...putFile('妈妈门诊病历-演示.png', makePng(360, 260, [140, 84, 84]), 'image/png'),
      category: '医疗', note: '心内科门诊病历（演示占位图）。关键词：高血压 换药 复查 王医生',
      healthReportId: reportMom.id,
    },
    {
      ...putFile('车险保单-演示.pdf', makePdf([
        'DEMO INSURANCE POLICY - NOT REAL',
        '',
        'Policy No : DEMO-0000-0002',
        'Type      : Motor (compulsory + commercial)',
        'Premium   : CNY 3,860.00',
        'Valid to  : 10-07 this year',
        '',
        'Generated by seed-demo.mjs',
      ]), 'application/pdf'),
      category: '保单', note: '车险保单，10/08 到期。关键词：车险 DEMO-0000-0002 续保 交强险',
    },
    {
      ...putFile('女儿成绩单-演示.png', makePng(360, 260, [92, 132, 88]), 'image/png'),
      category: '教育', note: '三年级上学期成绩单（演示占位图）。关键词：成绩单 三年级',
    },
    {
      ...putFile('物业费收据-演示.png', makePng(360, 260, [128, 112, 72]), 'image/png'),
      category: '账单', note: '上季度物业费收据（演示占位图）。关键词：物业费 收据',
    },
    {
      ...putFile('房产证复印件-演示.png', makePng(360, 260, [96, 96, 112]), 'image/png'),
      category: '证件', note: '房产证复印件（演示占位图）。关键词：房产证 不动产权',
      vaultItemId: vaultItems.find((v) => v.title === '房产信息')?.id,
    },
    {
      ...putFile('本季度支出汇总.csv', Buffer.from(
        '﻿月份,真实支出,住房,餐饮,医疗,教育,交通\n' +
        '第一个月,14280,7440,529.8,156.4,2400,500\n' +
        '第二个月,16940,6820,537.2,532.6,5120,580\n' +
        '第三个月,13810,7440,396.8,476.4,0,528\n',
        'utf8'
      ), 'text/csv'),
      category: '交付物', note: '三个月支出汇总，Excel 能直接打开。关键词：支出 汇总 对比 季度',
    },
    {
      ...putFile('宽带三家比价.html', Buffer.from(
        '<!doctype html><meta charset="utf-8"><title>宽带三家比价</title>' +
        '<body style="font:15px/1.7 system-ui;max-width:40rem;margin:3rem auto;padding:0 1.5rem">' +
        '<h1 style="font-size:1.2rem">宽带三家比价</h1>' +
        '<table style="width:100%;border-collapse:collapse;font-size:.9rem">' +
        '<tr><th style="text-align:left;border-bottom:1px solid #8883;padding:.5rem">运营商</th>' +
        '<th style="text-align:left;border-bottom:1px solid #8883;padding:.5rem">带宽</th>' +
        '<th style="text-align:left;border-bottom:1px solid #8883;padding:.5rem">首年</th>' +
        '<th style="text-align:left;border-bottom:1px solid #8883;padding:.5rem">次年</th></tr>' +
        '<tr><td style="padding:.5rem">移动</td><td>500M</td><td>¥1,380</td><td>没给准话</td></tr>' +
        '<tr><td style="padding:.5rem">电信</td><td>500M</td><td>¥1,180</td><td>¥1,580</td></tr>' +
        '<tr><td style="padding:.5rem">联通</td><td>300M</td><td>¥980</td><td>¥1,280</td></tr>' +
        '</table><p style="color:#999;font-size:.8rem">⚠ 演示数据</p></body>',
        'utf8'
      ), 'text/html'),
      category: '交付物', note: '单张呈现页，不属于任何专题。关键词：宽带 比价 移动 电信 联通',
    },
    {
      ...putFile('装修注意事项.md', Buffer.from(
        '# 装修注意事项（自己整理的）\n\n' +
        '- 防水做完**一定要做闭水试验**，48 小时，自己去看\n' +
        '- 电线用 2.5 平方，空调线用 4 平方，别让人蒙混\n' +
        '- 开槽走线要横平竖直，斜着走以后钉钉子会打到\n' +
        '- 管理费按总价 8-12% 是常见的，18% 偏高\n' +
        '- 材料损耗按 5-8% 算，超过 10% 要问清楚\n\n' +
        '⚠ 演示数据\n',
        'utf8'
      ), 'text/markdown'),
      category: '交付物', note: '装修经验清单。关键词：装修 防水 闭水试验 电线 管理费 损耗',
    },
  ];
  for (const f of files) {
    const { statementId, healthReportId, vaultItemId, ...rest2 } = f;
    await db.attachment.create({
      data: {
        ...rest2,
        uploadedBy: 'secretary',
        ...(statementId ? { statementId } : {}),
        ...(healthReportId ? { healthReportId } : {}),
        ...(vaultItemId ? { vaultItemId } : {}),
      },
    });
  }

  // 专题底下也挂一份别人给的东西 —— 专题页的附件区才不是空的
  await db.attachment.create({
    data: {
      ...putFile('装修报价单-乙方案.pdf', makePdf([
        'DEMO QUOTE B - NOT A REAL DOCUMENT',
        '',
        'Waterproofing        CNY  8,200',
        'Rewiring             CNY 11,400',
        'Wall repainting      CNY  6,800',
        'Management fee       CNY  3,600',
        'Material loss        CNY 11,000',
        '--------------------------------',
        'Total                CNY 41,000',
      ]), 'application/pdf'),
      category: '合同',
      note: '乙方案报价单。关键词：装修 报价 乙方案',
      uploadedBy: 'secretary',
      topicId: topicHome.id,
    },
  });

  // ══════════ 对话记录 ══════════
  // 对话页里的几个对话。**不挂 taskId** —— 挂了就只出现在那条任务下面。
  // 一件事一个对话：主人的某一句话开了一个新对话，就在 CONVO_TITLES 里给它起名；
  // 没在表里的那句接在上一个对话后面（「这个月花了多少」就接在账单那个里）。
  const CONVO_TITLES = {
    '帮我记一下，下周要交物业费': '交物业费',
    '我的招行卡号是多少': '招行卡号',
    '妈妈的体检报告，帮我看看': '妈妈的体检报告',
    '帮我把这三个月的账单导进来': '账单和支出',
    '装修两家报价差了两万七，正常吗': '装修报价对比',
    '把身份证和房产证存一下': '存证件',
    '车险快到期了，帮我盯一下': '车险续保',
    '还有什么没办的': '还有什么没办的',
  };
  const convo = [
    ['user', '帮我记一下，下周要交物业费', -14],
    ['secretary', '记下了，「交物业费」进了任务，3 天后到期。\n\n去年是 ¥1,860，物业群里说今年没涨。到时候对一下金额。', -14],
    ['user', '我的招行卡号是多少', -12],
    ['secretary', '**6225 8800 0000 0000**，成都高新支行，预留手机 138 0000 0000。\n\n房贷也是从这张扣的。', -12],
    ['user', '妈妈的体检报告，帮我看看', -11],
    ['secretary', `报告读完了，已经入库（健康 → 妈妈 → 高血压复诊）。

**要紧的一条：血压 158/96，没控制住。** 参考值是 <140/90。

其他几项：

| 项目 | 值 | 参考 | 判断 |
| --- | --- | --- | --- |
| 肌酐 | 68 | 41-81 | 正常 |
| 血钾 | 4.1 | 3.5-5.3 | 正常 |
| 总胆固醇 | 5.42 | <5.18 | 偏高一点 |
| 颈动脉 | 内膜稍增厚 | — | 留意 |

**肾功能和血钾正常是好消息** —— 长期吃降压药最怕这两样出问题，现在可以安心换药。

医生换成了苯磺酸氨氯地平片 5mg 每日一次。我建了「陪妈妈复查血压」的任务，
三个月后到期。记得让她**早晚各测一次记下来**，复查时医生要看。`, -11],
    ['user', '帮我把这三个月的账单导进来', -9],
    ['secretary', `三个月都导完了，勾稽全过（期初 + 收 − 支 = 期末，一分不差）。

**真实支出**（剔掉了理财赎回、转余额宝、报销垫付这类钱在自己口袋之间挪的）：

- 第一个月 ¥14,280
- 第二个月 ¥16,940 ↑
- 第三个月 ¥13,810

中间那一跳是培训班一次交了两个季度 ¥4,800，摊开看三个月其实是平的。

写了份小结放在文稿页（《这个季度的钱花到哪了》），里面有四条结论。
最值得看的一条：**医疗支出在涨**，¥156 → ¥476，都是妈妈的药和门诊。`, -9],
    ['user', '这个月花了多少', -8],
    ['secretary', '本月真实支出 **¥13,810**。\n\n大头：房贷 6,820、宽带续费 1,280、超市 709。\n\n已经剔掉理财赎回 3,000 和转余额宝 3,000 —— 那只是钱在自己口袋之间挪。', -8],
    ['user', '装修两家报价差了两万七，正常吗', -7],
    ['secretary', '差在**管理费**和**电路**上，详细拆解写在「找三家装修公司要报价」那条任务里了，点进去看。\n\n一句话：管理费差 8,400（18% vs 8%），这一项纯看谈；电路差 7,200，要问清是不是同样线材规格。\n\n另外我写了份调研任务书，等成都行情数据回来再决定哪家价格合理。**别只看总价选人。**', -7],
    ['user', '把身份证和房产证存一下', -6],
    ['secretary', '存好了，都在资料库里：\n\n- **身份证（本人）** —— 标了敏感，号码默认打码，要看点一下才显示\n- **房产信息** —— 产权证号、面积、房贷银行、月供都在，复印件挂在这条下面\n\n资料库里的东西可以一键复制，填表的时候不用再翻原件。', -6],
    ['user', '车险快到期了，帮我盯一下', -5],
    ['secretary', '已经建了任务，10/08 到期，还有 14 天。\n\n去年 ¥3,860。我把打电话要问的四件事写成了话术，挂在那条任务上，照着念就行。\n\n**重点是要书面报价** —— 上次电话里说 3,600，出单变成 3,860。', -5],
    ['user', '打了电话，报价 4,120，比去年贵了 260', -3],
    ['secretary', '贵 6.7%。**先别答应。**\n\n你连续三年没出险，交强险应该往下走才对（最多能降 30%）。让他们把交强和商业拆开报，看涨的到底是哪一半。\n\n另外支付宝和官网通常比电话渠道便宜 5-10%，值得花十分钟比一下。\n\n详细的写在任务里了。', -2],
    ['user', '还有什么没办的', -1],
    ['secretary', `眼下要动手的六件：

**已经过期的**
- 社保卡换新 —— 逾期 2 天。要带身份证原件、本人到场。

**一周内**
- 交物业费（3 天后）
- 找三家装修公司要报价（6 天后）
- 女儿秋季校服尺码（9 天后，回复班主任）

**两周内**
- 车险比价（14 天后到期）—— 这条最要紧，过期就断保
- 换宽带套餐（等移动回电）

**被挡着的一件**：装修签合同，要等报价和调研都回来，现在别签。`, -1],
  ];
  let conv = null;
  for (const [role, content, back] of convo) {
    const at = day(back);
    if (role === 'user' && CONVO_TITLES[content]) {
      conv = await db.conversation.create({ data: { title: CONVO_TITLES[content], createdAt: at } });
    }
    await db.message.create({
      data: {
        role,
        content,
        sender: role === 'user' ? '本人' : null,
        status: role === 'user' ? 'handled' : 'read',
        createdAt: at,
        conversationId: conv.id,
      },
    });
    // 列表按「最后说话的时间」排
    await db.conversation.update({ where: { id: conv.id }, data: { updatedAt: at } });
  }

  const counts = {
    对话: await db.conversation.count(),
    对话记录: await db.message.count(),
    任务: await db.task.count(),
    资料: await db.vaultItem.count(),
    月结单: await db.statement.count(),
    交易: await db.transaction.count(),
    家庭成员: await db.member.count(),
    体检报告: await db.healthReport.count(),
    体检指标: await db.healthMetric.count(),
    保单: await db.policy.count(),
    专题: await db.topic.count(),
    文稿: await db.document.count(),
    文件: await db.attachment.count(),
  };
  console.log('\n灌好了：');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(5, '　')} ${v}`);
  console.log(`\n文件真写到了 ${path.join(UPLOAD_DIR, BUCKET)}/，点得开。`);
  console.log('所有号码、金额都是编的，别当真。');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
