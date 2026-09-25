import { db } from '@/lib/db';
import { createTask } from '../actions';
import PageHeader from '@/components/PageHeader';
import FormDialog from '@/components/FormDialog';
import OverviewDialog from './OverviewDialog';
import TaskOverview from './TaskOverview';
import OwnerSelect from '@/components/OwnerSelect';
import StatusSelect from '@/components/StatusSelect';
import Link from 'next/link';
import { TASK_STATUS, CATEGORIES, formatDate } from '@/lib/format';
import { getOwners } from '@/lib/owners';

/**
 * 任务列表 —— 页头、三行筛选、分组卡片，整块。
 *
 * 为什么是组件不是页面：宽屏上这一列要同时出现在 `/tasks`（右边是空的）和
 * `/tasks/<id>`（右边是详情）两个路由里。抽出来之前只有一个选择 ——
 * 要么把列表在详情页再抄一遍，要么上平行路由。
 *
 * 筛选状态（c/s/o）由调用方从 URL 里取好传进来：列表页直接从自己的
 * searchParams 拿，详情页从 `?from=` 里解析 —— 那串本来就带着「从哪一屏点进来的」。
 */

const ORDER = ['doing', 'blocked', 'todo', 'done', 'cancelled'];
const OPEN = ['todo', 'doing', 'blocked'];

/**
 * 文稿按用途分三类，卡片上直接告诉你「该拿它干嘛」。
 * 类型本来就存在 Document.category 里，以前只是没显示 —— 于是所有文稿
 * 长得一模一样，点进去才知道这份是要复制走的还是要照着做的。
 */
const DOC_USE: Record<string, string> = {
  调研任务书: '复制给 AI',
  操作指引: '照着做',
  话术: '照着问',
  简报: '带给对方',
  决策记录: '定过的事',
};

/**
 * 状态行。跟分类是两个维度，所以分两行 —— 「过期」本来就不是分类，
 * 以前混在分类行里，等于一行里塞了两种东西。
 * 「过期」是「未完成」的子集，不是并列项，摆这儿纯粹是当快捷入口用。
 *
 * ★ open 这一格原来叫「进行中」，2026-09-09 改成「未完成」。
 * 卡片上加了状态下拉（未开始 / 进行中 / 已完成）之后，「进行中」在同一屏上
 * 有了两个意思：这里指**所有没做完的**（含未开始），下拉里指**一个具体状态**。
 * 同一个词两种含义，正是筛选条最不能有的东西。
 */
const STATUS_TABS = [
  { key: 'all', label: '全部', tone: 'brand' },
  { key: 'open', label: '未完成', tone: 'brand' },
  { key: 'overdue', label: '过期', tone: 'red' },
  { key: 'done', label: '已完成', tone: 'brand' },
  { key: 'cancelled', label: '已取消', tone: 'brand' },
] as const;

type StatusKey = (typeof STATUS_TABS)[number]['key'];

/** 今天零点。跟截止日比大小要按天算，不能按毫秒 —— 否则今天到期的当场就算过期。 */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 过期几天。用来显示「已过期 8 天」，也用来排序。 */
function overdueDays(due: Date | null, today: Date) {
  if (!due) return 0;
  const diff = today.getTime() - new Date(due).setHours(0, 0, 0, 0);
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0;
}

/** 一条任务算不算落在某个状态标签下。 */
function matchStatus(t: { status: string; dueDate: Date | null }, key: StatusKey, today: Date) {
  if (key === 'all') return true;
  if (key === 'open') return OPEN.includes(t.status);
  if (key === 'overdue') return OPEN.includes(t.status) && overdueDays(t.dueDate, today) > 0;
  return t.status === key;
}

/**
 * 当前筛选下，列表里**排在最上面的那一条**。宽屏 `/tasks` 默认把它的详情摆在右边。
 *
 * ⚠ 规则必须跟下面 TaskList 的渲染一模一样（默认状态、分类/负责人的合法性判断、
 * 按 createdAt 倒序、再按 ORDER 分组），否则右边开的那条不是左边高亮的第一张。
 * 改了 TaskList 的筛选或排序，这里要跟着改。
 */
export async function firstVisibleTaskId({ c, s, o }: { c?: string; s?: string; o?: string }) {
  const today = startOfToday();
  const all = await db.task.findMany({
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true, status: true, dueDate: true, category: true, owner: true },
  });
  const status = (STATUS_TABS.find((x) => x.key === s)?.key ?? 'open') as StatusKey;
  const cat = c && all.some((t) => t.category === c) ? c : undefined;
  const owners = new Set<string>([...(await getOwners()), ...(all.map((t) => t.owner).filter(Boolean) as string[])]);
  const own = o === 'none' || (o && owners.has(o)) ? o : undefined;
  const visible = all.filter(
    (t) =>
      matchStatus(t, status, today) &&
      (!cat || t.category === cat) &&
      (!own || (own === 'none' ? !t.owner : t.owner === own)),
  );
  for (const st of ORDER) {
    const hit = visible.find((t) => t.status === st);
    if (hit) return hit.id;
  }
  return null;
}

export default async function TaskList({
  c,
  s,
  o,
  activeId,
}: {
  /** 分类 */
  c?: string;
  /** 状态 */
  s?: string;
  /** 负责人 */
  o?: string;
  /** 宽屏两栏时，右边正开着的那条 —— 列表里把它标出来 */
  activeId?: string;
}) {
  const today = startOfToday();

  const all = await db.task.findMany({
    // ── 新建的排最上面 ────────────────────────────────────────────
    // 原来是「优先级升序 + 最后更新时间降序」，两个键都有问题：
    //
    // ★ **updatedAt 让列表在主人眼皮底下自己重排。** 我每改一次任务
    //   （补话术、换挂的文稿、回一条留言）那条就窜到最前面 ——
    //   有的任务一天被我动了四次。主人上次看到的位置，下次就不在了。
    //
    // ★ **priority 分得太平均，当排序键几乎是噪音。** 66 条未完成里
    //   P1 有 27 条、P2 有 25 条、P3 有 14 条 —— 它不是把几件急事挑出来，
    //   是把列表切成三大块，新加的东西一律被压在 27 条 P1 底下。
    //
    // createdAt 稳定、不受我改动影响，而且「刚交代的事在最上面」
    // 本来就是主人翻这一页时的预期。逾期不靠排序提醒 ——
    // 卡片上那个红色的「逾期 N 天」比排到前面更显眼。
    orderBy: [{ createdAt: 'desc' }],
    include: {
      attachments: true,
      doc: { select: { id: true, title: true, category: true } },
      blocker: { select: { id: true, title: true, status: true, dueDate: true, owner: true } },
      // 留言只取状态，不取正文 —— 卡片上只显示「有没有新的」这一个信号。
      messages: { select: { role: true, status: true } },
    },
  });

  // 状态默认「未完成」—— 已完成/已取消的默认不占版面。以前它们排在 22 张
  // 待办卡片后面，主人标完成后就再也翻不到，还以为被删了。现在藏是可以的，
  // 因为状态行上那个带数字的胶囊明摆着告诉你它们还在。
  const status = (STATUS_TABS.find((x) => x.key === s)?.key ?? 'open') as StatusKey;

  // 分类取库里真实有的，不是 CATEGORIES 常量：开发/系统/身份这些是我建任务时
  // 随手写的，不在新建表单的下拉里，写死常量就会让它们筛不出来。
  // 认定分类时看的是全部任务，不是当前状态下的 —— 否则切一下状态，
  // 正选着的分类就会失效跳回全部。
  const cat = c && all.some((t) => t.category === c) ? c : undefined;

  // 负责人是第三个维度。家里两个人在办事，「这件事归谁」现在是最先要问的一句，
  // 所以这一行摆在最上面。'none' 是「未指派」—— 它不是没意义的空档，
  // 恰恰是最该被看见的一格：没人认领的事最容易两个人都以为对方在办。
  const members = await getOwners();
  const owners = [...new Set([...members, ...all.map((t) => t.owner).filter(Boolean) as string[]])];
  const own = o === 'none' || (o && owners.includes(o)) ? o : undefined;
  const matchOwner = (t: (typeof all)[number]) =>
    !own || (own === 'none' ? !t.owner : t.owner === own);
  const matchCat = (t: (typeof all)[number]) => !cat || t.category === cat;

  // 两行是两个维度，数字要交叉算：分类行的数字 =「在当前状态下这一类有几条」，
  // 状态行的数字 =「在当前分类下这个状态有几条」。各自只算另一维已选的那部分，
  // 点下去才不会出现「写着 3 条，进去空的」。
  // 三个维度，每一行的数字都只算「另外两维已选的那部分」，
  // 点下去才不会出现「写着 3 条，进去空的」。
  const byStatus = all.filter((t) => matchStatus(t, status, today) && matchOwner(t));
  const byCat = all.filter((t) => matchCat(t) && matchOwner(t));
  const byOwnerRow = all.filter((t) => matchStatus(t, status, today) && matchCat(t));
  const tasks = byStatus.filter(matchCat);
  // 总览按钮上的红点：不管当前筛的是什么，逾期都是全局的
  const overdueCount = all.filter((t) => matchStatus(t, 'overdue', today)).length;

  // 分类行**永远列全部 10 个**，哪怕当前状态下是 0。
  // 第一版只列「当前状态下有货」的，于是每点一下状态，这一行就换个形状
  // （未完成 7 个、已完成 4 个），横滑到一半位置全变了；而且要看「健康的已完成」
  // 得先切回全部、找到健康、再切状态 —— 一个本该一步的事绕成三步。
  // 「健康 · 已完成 0」本身就是个答案，不是错误。
  const counts = new Map<string, number>();
  for (const t of all) counts.set(t.category, 0);
  for (const t of byStatus) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  const cats = [...counts.keys()].sort((a, b) => {
    const ia = CATEGORIES.indexOf(a as (typeof CATEGORIES)[number]);
    const ib = CATEGORIES.indexOf(b as (typeof CATEGORIES)[number]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

  const statusCounts = new Map(
    STATUS_TABS.map((x) => [x.key, byCat.filter((t) => matchStatus(t, x.key, today)).length])
  );

  /** 改一维，另一维原样带着走 —— 筛完「财务」再点「已完成」，不该把财务丢了。 */
  const ownerCounts = new Map<string, number>([
    ['none', byOwnerRow.filter((t) => !t.owner).length],
    ...owners.map((n) => [n, byOwnerRow.filter((t) => t.owner === n).length] as [string, number]),
  ]);

  /**
   * 改一维，另外两维原样带着走 —— 筛完「代办人」再点「已完成」，不该把代办人丢了。
   *
   * ⚠ 清空负责人要传 **null，不能传 undefined**。默认参数只在实参是 `undefined`
   * 时才生效，所以 `linkTo(cat, status, undefined)` 会原地退回 `own` ——
   * 「负责/全部」那一格于是链回它自己，点了没任何反应。
   * （2026-09-09 主人发现的。分类和状态两维没这毛病，因为它们没用默认参数。）
   */
  const linkTo = (
    nextCat: string | undefined,
    nextStatus: StatusKey,
    nextOwner: string | null | undefined = own,
  ) => {
    const q = new URLSearchParams();
    if (nextOwner) q.set('o', nextOwner);
    if (nextCat) q.set('c', nextCat);
    if (nextStatus !== 'open') q.set('s', nextStatus); // 默认值不写进 URL，链接干净些
    const qs = q.toString();
    return qs ? `/tasks?${qs}` : '/tasks';
  };

  /**
   * 被挡住 = 有前置任务，且前置还没做完。**派生，不存库** —— 前置一标完成就自动放行。
   * 软提示：照样能标完成、能交结果，只是排到后面并压暗，因为「现在能开工的」才是
   * 翻这一屏时真正想看到的。
   */
  const isBlocked = (t: (typeof all)[number]) =>
    !!t.blocker && !['done', 'cancelled'].includes(t.blocker.status);

  /** 前置的截止日不早于自己的 —— 那后继必然逾期。这类错肉眼看 30 条根本发现不了。 */
  const dateClash = (t: (typeof all)[number]) =>
    !!t.blocker?.dueDate && !!t.dueDate && new Date(t.blocker.dueDate) >= new Date(t.dueDate);

  // ── 排序：新建的排最上面，就这一条规则 ──────────────────────────
  //
  // 原来是四层：逾期最前 → 优先级 → 截止日 → 最后更新。主人说找不到刚交代
  // 的事，量完就明白了：**65 条未完成里 15 条已逾期**，它们占死了最前面；
  // 剩下 40 条按优先级和截止日排，一件今天新建、截止日在月底的任务
  // 直接掉到第三屏。最近一周新建了 18 条，只有 2 条是逾期的 ——
  // 也就是说**新任务几乎必然被埋**。
  //
  // 另外 updatedAt 那层更麻烦：我每改一次任务（补话术、换文稿、回留言）
  // 那条就窜位，有的一天被动四次。**列表在主人眼皮底下自己重排，
  // 上次看到的位置下次就不在了。** createdAt 不受我改动影响。
  //
  // ⚠ 换掉之后逾期的不再自动上浮。**代价是认过的** —— 卡片上那个红色的
  // 「逾期 N 天」还在，而且筛选条里点一下就能只看未完成。要是主人回头
  // 觉得漏事，第一个该加回来的是逾期那层，不是优先级。
  //
  // isBlocked / dateClash 保留，它们管的是卡片上怎么显示（压暗、提示），
  // 跟排序无关了。
  const sorted = [...tasks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const groups = ORDER.map((s) => ({ status: s, items: sorted.filter((t) => t.status === s) })).filter(
    (g) => g.items.length > 0
  );

  // empty = 这一格是 0。**照样画出来，只是压暗** —— 位置比省地方要紧，
  // 而且「这一格没有」本身就是想知道的答案。
  const chip = (active: boolean, tone: 'brand' | 'red' = 'brand', empty = false) =>
    `shrink-0 text-xs px-3 py-1.5 rounded-full border ${empty && !active ? 'opacity-40' : ''} ${
      active
        ? tone === 'red'
          ? 'bg-red-500 text-white border-red-500'
          : 'bg-brand-500 text-white border-brand-500'
        : tone === 'red'
          ? 'text-red-600 dark:text-red-400 border-red-300 dark:border-red-500/40'
          : 'muted'
    }`;

  return (
    <>
      <PageHeader
        title="任务"
        subtitle={`${own ? `${own === 'none' ? '未指派' : own} · ` : ''}${cat ? `${cat} · ` : ''}${STATUS_TABS.find((x) => x.key === status)!.label} ${tasks.length} 项`}
        action={
          <>
          {/* 总览是弹窗，不占右栏 —— 右栏只要有内容就一定是某条任务的详情。
              同一块区域时而是总览时而是详情，看的人得先判断「这是哪种」。 */}
          <OverviewDialog alert={overdueCount}>
            <TaskOverview />
          </OverviewDialog>
          <FormDialog label="+ 新建" title="新建任务">
            <form action={createTask} className="space-y-3">
              <input
                name="title"
                required
                placeholder="要办的事，例如：续保车险"
                className="w-full rounded-xl border px-4 py-2.5 bg-transparent outline-none focus:border-brand-500"
                style={{ borderColor: 'var(--border)' }}
              />
              <textarea
                name="detail"
                rows={2}
                placeholder="补充说明（可选）"
                className="w-full rounded-xl border px-4 py-2.5 bg-transparent outline-none focus:border-brand-500 resize-none"
                style={{ borderColor: 'var(--border)' }}
              />
              <div className="grid grid-cols-2 gap-2">
                {/* 正在按某一类筛的时候，新建默认就是那一类 —— 十有八九是想往这类里加 */}
                <select
                  name="category"
                  defaultValue={cat}
                  className="rounded-xl border px-3 py-2.5 bg-transparent"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {/* 正在按某个人筛的时候，新建默认就归他 —— 跟分类一个道理 */}
                <select
                  name="owner"
                  defaultValue={own === 'none' ? '' : (own ?? '')}
                  className="rounded-xl border px-3 py-2.5 bg-transparent"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <option value="">未指派</option>
                  {owners.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <select name="priority" defaultValue="2" className="rounded-xl border px-3 py-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }}>
                  <option value="1">高</option>
                  <option value="2">中</option>
                  <option value="3">低</option>
                </select>
                <input type="date" name="dueDate" className="rounded-xl border px-3 py-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }} />
              </div>
              <button className="w-full rounded-xl bg-brand-500 text-white font-medium py-2.5 active:bg-brand-700">
                创建
              </button>
            </form>
          </FormDialog>
          </>
        }
      />

      {/* 两行筛选：上分类、下状态。以前全部任务挤在一条列表里，18 条
          「待归类交易」把一条要去医院的待办冲到了第三屏；后来加了分类，
          但把「过期」也塞进了分类行 —— 那是状态，不是分类。现在各归各位。 */}
      {/* ⚠ 宽屏上筛选条改成折行：手机的滚动条是浮层、不占地方，桌面上是常驻的
          一道灰杠，三行筛选就是三道杠。左栏也没宽到能一行放下十个分类。 */}
      {all.length > 0 && (
        <div className="px-4 pt-3 space-y-1.5">
          <div className="flex gap-1.5 items-center overflow-x-auto lg:flex-wrap lg:overflow-visible pb-0.5">
            <span className="shrink-0 muted text-[11px] pr-0.5">负责</span>
            <Link href={linkTo(cat, status, null)} className={chip(!own)} style={!own ? undefined : { borderColor: 'var(--border)' }}>
              全部 {byOwnerRow.length}
            </Link>
            {owners.map((n) => (
              <Link
                key={n}
                href={linkTo(cat, status, n)}
                className={chip(own === n, 'brand', ownerCounts.get(n) === 0)}
                style={own === n ? undefined : { borderColor: 'var(--border)' }}
              >
                {n} {ownerCounts.get(n)}
              </Link>
            ))}
            <Link
              href={linkTo(cat, status, 'none')}
              className={chip(own === 'none', 'brand', ownerCounts.get('none') === 0)}
              style={own === 'none' ? undefined : { borderColor: 'var(--border)' }}
            >
              未指派 {ownerCounts.get('none')}
            </Link>
          </div>
          <div className="flex gap-1.5 items-center overflow-x-auto lg:flex-wrap lg:overflow-visible pb-0.5">
            <span className="shrink-0 muted text-[11px] pr-0.5">分类</span>
            <Link href={linkTo(undefined, status)} className={chip(!cat)} style={!cat ? undefined : { borderColor: 'var(--border)' }}>
              全部 {byStatus.length}
            </Link>
            {cats.map((name) => (
              <Link
                key={name}
                href={linkTo(name, status)}
                className={chip(cat === name, 'brand', counts.get(name) === 0)}
                style={cat === name ? undefined : { borderColor: 'var(--border)' }}
              >
                {name} {counts.get(name)}
              </Link>
            ))}
          </div>
          <div className="flex gap-1.5 items-center overflow-x-auto lg:flex-wrap lg:overflow-visible pb-1">
            <span className="shrink-0 muted text-[11px] pr-0.5">状态</span>
            {/* 跟分类行同一条规矩：五个全常驻，0 的压暗不隐身 */}
            {STATUS_TABS.map((x) => (
              <Link
                key={x.key}
                href={linkTo(cat, x.key)}
                className={chip(status === x.key, x.tone, statusCounts.get(x.key) === 0)}
                style={status === x.key || x.tone === 'red' ? undefined : { borderColor: 'var(--border)' }}
              >
                {x.label} {statusCounts.get(x.key)}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-4 space-y-6">
        {all.length === 0 && (
          <p className="muted text-sm text-center py-20 leading-relaxed">
            还没有任务。
            <br />
            在「沟通」里说一声，或点右上角新建。
          </p>
        )}

        {all.length > 0 && tasks.length === 0 && (
          <p className="muted text-sm text-center py-20">
            {status === 'all'
              ? `${cat ?? '这里'}下面还没有任务。`
              : `${cat ?? '这里'}没有「${STATUS_TABS.find((x) => x.key === status)!.label}」的任务。`}
          </p>
        )}

        {groups.map((g) => (
          <section key={g.status}>
            <h2 className="muted text-xs font-medium mb-2 px-1">
              {TASK_STATUS[g.status].label} · {g.items.length}
            </h2>
            <div className="space-y-2">
              {g.items.map((t) => {
                const late = OPEN.includes(t.status) ? overdueDays(t.dueDate, today) : 0;
                return (
                <div
                  key={t.id}
                  // 宽屏两栏时右边正开着的那条要标出来 —— 否则在 30 张一样的卡片里
                  // 根本看不出详情是哪一条的。窄屏上 activeId 永远是空的。
                  className={`surface border rounded-2xl px-4 py-3.5 relative ${
                    isBlocked(t) && OPEN.includes(t.status) ? 'opacity-60' : ''
                  } ${t.id === activeId ? 'ring-2 ring-brand-500' : ''}`}
                  style={{ borderColor: late ? 'rgb(248 113 113 / 0.5)' : 'var(--border)' }}
                >
                  {/* 整张卡片就是详情页的入口。盖一层透明链接在卡面上，
                      下面要点的控件各自抬到它上层（z-[2]）。
                      ?from= 带的是**筛选后的那一屏**，退回来还在代办人那一栏。 */}
                  <Link
                    href={`/tasks/${t.id}?from=${encodeURIComponent(linkTo(cat, status))}`}
                    className="absolute inset-0 z-[1] rounded-2xl"
                    aria-label={`打开任务「${t.title}」`}
                  />

                  {/* 卡片上只有标题。摘要那一行也删了 —— 数了一遍 60 条未完成任务，
                      标题平均 24 个字，绝大多数本来就把「做什么、为什么」说全了
                      （「某某医保 12/03 自动续保 —— 确认扣费账户有钱，别丢了保证续保权」），
                      再跟一句摘要基本是换个说法重说一遍。
                      ★ 代价是**标题从此扛全部扫读负担**，写任务时标题必须独立成立。
                      状态胶囊也删了：分组标题已经写着「进行中 · 12」。
                      P1 用一个红点代替「优先级 高」四个字，中低不显示 —— 大多数都是中，
                      写出来只是噪音。 */}
                  <h3 className={`font-medium leading-snug flex items-baseline gap-1.5 ${['done', 'cancelled'].includes(t.status) ? 'line-through muted' : ''}`}>
                    {t.priority === 1 && OPEN.includes(t.status) && (
                      <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-red-500 translate-y-[-2px]" aria-label="高优先级" />
                    )}
                    <span className="min-w-0">{t.title}</span>
                  </h3>

                  {/* 依赖只在**还挡着**的时候说话。★「前置已完成」那条删了 ——
                      前置做完 = 可以开工 = 正常状态，不需要一个标签来宣布正常。
                      留着「在等谁」是因为它解释了这张卡为什么压暗、为什么沉到底下。 */}
                  {isBlocked(t) && OPEN.includes(t.status) && (
                    <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                      ⏳ 等「{t.blocker!.title}」
                      {t.blocker!.owner && `（${t.blocker!.owner}）`}
                      {dateClash(t) && (
                        <span className="text-red-600 dark:text-red-400"> ⚠ 前置比这条还晚到期，排期有问题</span>
                      )}
                    </p>
                  )}

                  {/* ── 卡片底栏：小字靠左、操作靠右，同一行 ────────────────
                      原来是「标题 → 小字 → 按钮」三段竖排，小字夹在中间，
                      读起来像被按钮压住的说明文。挪到同一行之后，
                      卡片就只剩上下两块：**上面说这是什么，下面是属性和操作。**

                      能这么放是因为量过：64 条未完成任务，小字平均只有 2.1 块
                      （绝大多数就是「分类 + 截止」），右边两个控件吃掉的宽度挤不着它。
                      罕见的长情况（分类+截止+文稿+附件+反馈+管家回了）靠 flex-wrap
                      自己折行，控件那侧 shrink-0 永远不被压扁。

                      ★「+ 交结果」挪去详情页了：它要开文件选择器、要写说明，
                      本来就不是扫一眼顺手点的动作，而且详情页上已经有一个。
                      64 条里只有 1 条有附件 —— 它在卡片上占着位置，几乎没被用过。

★ 状态做成下拉，跟负责人并排。我先后否过两次（先说「进行中只有
                      4/64 不值当」，后说「三个控件挤坏了标签」），主人三次都要 ——
                      而他这版把第二个理由解掉了：「已完成」是下拉里的一项，
                      那个「完成」按钮就没了，右边仍然只有两个控件。
                      细节写在 StatusSelect.tsx。 */}
                  <div className="flex items-center justify-between gap-3 mt-3">
                    <div className="flex items-center gap-x-2.5 gap-y-1.5 muted text-[11px] flex-wrap min-w-0">
                      {/* 分类是任务自己的属性，人人都有，所以不带图标 */}
                      <span>{t.category}</span>
                      {t.dueDate && (
                        <span className={late ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                          {late ? `逾期 ${late} 天` : `截止 ${formatDate(t.dueDate)}`}
                        </span>
                      )}
                      {/* 「照着问 / 照着做」说的是**挂着的那份文稿**怎么用，不是任务的分类。
                          只有 13/64 有文稿，带个图标就能跟左边的分类一眼分开。 */}
                      {t.doc && (
                        <span className="inline-flex items-center gap-1">
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                          </svg>
                          {DOC_USE[t.doc.category ?? ''] ?? '文稿'}
                        </span>
                      )}
                      {t.attachments.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                          </svg>
                          {t.attachments.length}
                        </span>
                      )}
                      {t.result && <span className="text-emerald-700 dark:text-emerald-400">已有反馈</span>}
                      {/* 留言板的两个信号，只在「有新东西」时出现。
                          ★ 未读的管家回复给主色，因为它是**主人/代办人点进来的唯一理由**
                          —— 交了东西却看不到回音，正是加留言板要治的病。
                          「待回」是给我自己看的：这条还欠一个答复。 */}
                      {t.messages.some((m) => m.role === 'secretary' && m.status === 'unread') && (
                        <span className="text-brand-700 dark:text-brand-300 font-medium">管家回了</span>
                      )}
                      {t.messages.some((m) => m.role === 'user' && m.status === 'pending') && (
                        <span className="text-amber-700 dark:text-amber-400">待回</span>
                      )}
                    </div>

                    {/* 右边只有两个控件：谁办、走到哪了。
                        ★「完成」按钮没了 —— 它变成状态下拉里的「已完成」。
                        「重新打开」也没了：done 的任务在同一个下拉里切回未开始。
                        所以加了状态反而比原来（负责人+完成+交结果）还窄。 */}
                    <div className="flex items-center gap-2 shrink-0 relative z-[2]">
                      <OwnerSelect taskId={t.id} owner={t.owner} members={members} />
                      <StatusSelect taskId={t.id} status={t.status} />
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
