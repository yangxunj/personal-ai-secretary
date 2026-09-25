import { db } from '@/lib/db';
import { markTaskRepliesRead } from '../actions';
import Prose from '@/components/Prose';
import CopyDoc from '@/components/CopyDoc';
import TaskComposer from '@/components/TaskComposer';
import { getOwners } from '@/lib/owners';
import AttachmentRow from '@/components/AttachmentRow';
import { TASK_STATUS, formatDate, formatTime } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';

const OPEN = ['todo', 'doing', 'blocked'];
const PRIORITY = { 1: '高', 2: '中', 3: '低' } as const;

/** 折叠阈值：超过这么多字就默认收起。管家的回复通常 700-1100 字，会收；
 *  代办人那种「好的。」「已經詢問，記錄如下」不会收。 */
const FOLD_OVER = 320;

/** 收起状态下显示的一句话。把 markdown 记号去掉，否则摘要里全是星号和井号。 */
function gist(s: string, n = 46) {
  const t = s
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*_`★|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * 任务详情页。
 *
 * 为什么每条任务都走这一个 URL，而不是「有文稿就跳文稿页」：
 *
 * ① **返回按钮**。文稿页靠 `?from=` 猜来路，多一种入口就多一次猜错的机会。
 * ② **任务的东西文稿页上没有** —— 负责人、截止、在等谁、附件、留言。
 * ③ **有的任务两样都有**（detail + doc），跳走就只能显示一个。
 *
 * ── 2026-09-10 重排：为「来回多轮推进」的任务而改 ──────────────
 *
 * 主人说这类任务的详情页「看着头晕」。量了一下确实：89 条任务里只有 5 条是
 * 多轮的，但正是这 5 条最难读 —— 空调那条 10 条往来、管家的回复每条 750~1100 字；
 * 另有两条各挂着一篇 3200+ 字的文稿，**整篇内联铺在对话前面**。
 *
 * 病根有三条，都不是配色能治的：
 *
 * ① **时间是乱的。** 页面顺序是「最新的说明 → 附件 → 从最旧到最新的留言」，
 *    最新的在最上面，第二新的在最下面，眼睛得来回跳。
 * ② **一件事两个入口。**「+ 交结果」在留言列表上面，留言框在下面，
 *    分在一屏两端。已合并成一个（见 TaskComposer）。
 * ③ ★ **历史被覆盖了。** 管家每一轮都整段重写 `Task.detail`，
 *    所以「当初是怎么交代的」在库里根本不存在。这一条是数据问题不是布局问题
 *    —— 规矩改成：**detail 写完就不动，每一轮的新要求写成一条留言**。
 *
 * 现在的结构，从上到下就是一条时间线：
 *
 *   标题 · 状态 · 进度条（来回几条、现在等谁）· 谁在等谁
 *   ├ 处理结果（有结论时）
 *   ├ 参考资料：文稿（折叠）、附件
 *   └ 经过：最初的要求 → 一来一回…（★ 最后一条默认展开，之前的收起）
 *     └ 留言框
 *
 * **折叠用原生 `<details>`**：不用 client component、不用 hydration，
 * iOS Safari 上也是原生行为。
 */
export default async function TaskDetail({
  id,
  backTo,
  markRead = true,
}: {
  id: string;
  /** 窄屏页头「返回」指向哪。宽屏上那条页头是隐藏的，用不到。 */
  backTo: string;
  /**
   * 打开 = 看过了，默认把这条下管家的回复标成已读。
   *
   * ⚠ **自动选中的那条必须传 false。** `/tasks` 宽屏上默认把列表第一条的
   * 详情摆在右边，但手机上那一栏是 hidden 的 —— 服务端照样渲染它。
   * 不关掉的话，「管家回了」这个提醒会在人根本没看到的情况下被消掉。
   */
  markRead?: boolean;
}) {
  const t = await db.task.findUnique({
    where: { id },
    include: {
      attachments: true,
      doc: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { attachments: { select: { id: true, filename: true, size: true } } },
      },
      blocker: { select: { id: true, title: true, status: true, dueDate: true, owner: true } },
      blocked: { select: { id: true, title: true, status: true, owner: true } },
    },
  });
  if (!t) notFound();

  // 打开详情页 = 看过了。见 actions.ts 里对「GET 写库」的说明。
  if (markRead) await markTaskRepliesRead(id);

  const ownAttachments = t.attachments.filter((a) => !a.messageId);

  const isBlocked = !!t.blocker && !['done', 'cancelled'].includes(t.blocker.status);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = t.dueDate
    ? Math.max(0, Math.floor((today.getTime() - new Date(t.dueDate).setHours(0, 0, 0, 0)) / 86_400_000))
    : 0;
  const late = OPEN.includes(t.status) && overdue > 0;

  const last = t.messages.length > 0 ? t.messages[t.messages.length - 1] : null;
  // 现在轮到谁：最后一句是管家说的 → 等他们；是他们说的 → 等管家。
  // 这是翻开这一页最想知道的一件事，而它以前只能自己数到底部。
  const waitingOn = !last ? null : last.role === 'secretary' ? (t.owner ?? '你') : '管家';

  const detail = (
    <>
      {/* 窄屏才需要这条：宽屏上列表就在左边，不用「返回」也不用再报一遍标题 */}
      <header className="lg:hidden sticky top-0 z-20 surface border-b pt-safe" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-1 px-2 h-14">
          <Link
            href={backTo}
            className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full active:opacity-60"
            aria-label="返回任务"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <p className="text-sm font-medium truncate">{t.title}</p>
        </div>
      </header>

      <article className="px-4 pt-6 pb-8">
        <div className="flex items-start justify-between gap-3">
          <h1 className={`text-[21px] font-semibold leading-snug ${['done', 'cancelled'].includes(t.status) ? 'line-through muted' : ''}`}>
            {t.title}
          </h1>
          <span className={`shrink-0 mt-1 text-[11px] px-2 py-0.5 rounded-full ${TASK_STATUS[t.status].cls}`}>
            {TASK_STATUS[t.status].label}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-3 muted text-[11px] flex-wrap">
          <span className="px-2 py-0.5 rounded-md" style={{ background: 'var(--bg)' }}>{t.category}</span>
          <span>优先级 {PRIORITY[t.priority as 1 | 2 | 3] ?? '中'}</span>
          {t.dueDate && (
            <span className={late ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
              截止 {formatDate(t.dueDate)}
              {late && `（已过期 ${overdue} 天）`}
            </span>
          )}
        </div>

        {/* ★ 进度条：来回了几条、最新是哪天、**现在轮到谁**。
            只在真的有来回、且任务还没完的时候出现
            —— 一条留言都没有的那 83 条任务，页面跟以前一样。
            「现在等谁」是翻开这一页最想知道的事，以前只能自己数到底部。 */}
        {last && OPEN.includes(t.status) && (
          <div className="mt-4 flex items-center gap-2 flex-wrap text-[12px] rounded-xl px-3 py-2" style={{ background: 'var(--bg)' }}>
            <span className="muted">来回 {t.messages.length} 条</span>
            <span className="muted">·</span>
            <span className="muted">最新 {formatDate(last.createdAt)}</span>
            <span className="muted">·</span>
            <span className={waitingOn === '管家' ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-brand-700 dark:text-brand-300 font-medium'}>
              现在等 {waitingOn}
            </span>
          </div>
        )}

        {/* 依赖：往前看在等谁，往后看谁在等它。 */}
        {(t.blocker || t.blocked.length > 0) && (
          <div className="mt-3 space-y-1.5">
            {t.blocker && (
              <div
                className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[12px] leading-relaxed ${
                  isBlocked ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'muted'
                }`}
                style={isBlocked ? undefined : { background: 'var(--bg)' }}
              >
                <span className="shrink-0">{isBlocked ? '⏳' : '✅'}</span>
                <Link href={`/tasks/${t.blocker.id}`} className="min-w-0 underline decoration-dotted underline-offset-2">
                  {isBlocked ? '等：' : '前置已完成：'}
                  {t.blocker.title}
                  {t.blocker.owner && `（${t.blocker.owner}）`}
                </Link>
              </div>
            )}
            {t.blocked.map((b) => (
              <div key={b.id} className="flex items-start gap-2 rounded-xl px-3 py-2 text-[12px] leading-relaxed muted" style={{ background: 'var(--bg)' }}>
                <span className="shrink-0">→</span>
                <Link href={`/tasks/${b.id}`} className="min-w-0 underline decoration-dotted underline-offset-2">
                  这条做完才轮到：{b.title}
                  {b.owner && `（${b.owner}）`}
                </Link>
              </div>
            ))}
          </div>
        )}

        {t.result && (
          <div className="mt-5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 p-4">
            <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 mb-1">处理结果</p>
            <Prose>{t.result}</Prose>
          </div>
        )}

        {/* ── 参考资料 ────────────────────────────────────────────
            ★ 文稿**不再整篇内联**。挂文稿的 16 条任务里，正文中位数 2145 字，
            那两篇分别 3377 字、3214 字 —— 整篇铺在这里，等于在
            「这件事到哪了」和「我要说句话」之间垫了三千字。
            折叠起来，标题和「复制全文」还在手边，要读点一下就开。 */}
        {(t.doc || ownAttachments.length > 0) && (
          <section className="mt-6">
            <h2 className="text-[13px] font-medium muted mb-2">参考资料</h2>

            {t.doc && (
              <details className="surface border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer px-3.5 py-3 active:opacity-60">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 shrink-0 rounded-xl flex items-center justify-center" style={{ background: 'var(--bg)' }}>
                      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{t.doc.title}</p>
                      <p className="muted text-[11px]">
                        {t.doc.category ? `${t.doc.category} · ` : ''}
                        {t.doc.body.length} 字 · 点开读
                      </p>
                    </div>
                  </div>
                </summary>
                <div className="px-3.5 pb-4">
                  <CopyDoc body={t.doc.body} title={t.doc.title} />
                  <div className="flex justify-end mt-1">
                    <Link
                      href={`/docs/${t.doc.id}?from=${encodeURIComponent(`/tasks/${t.id}`)}`}
                      className="text-[11px] muted underline decoration-dotted underline-offset-2"
                    >
                      单独打开
                    </Link>
                  </div>
                  <hr className="my-4 border-0 border-t" style={{ borderColor: 'var(--border)' }} />
                  <Prose>{t.doc.body}</Prose>
                </div>
              </details>
            )}

            {/* ★ 只列**不属于任何留言的**附件 —— 回传上来的附件两边都挂，
                照单全列的话同一个文件在这页上会出现两次。
                留言里的附件跟着它那句话显示，上下文更全。 */}
            {ownAttachments.length > 0 && (
              <div className={`space-y-2 ${t.doc ? 'mt-2' : ''}`}>
                {ownAttachments.map((a) => (
                  <AttachmentRow key={a.id} id={a.id} filename={a.filename} size={a.size} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── 经过 ─────────────────────────────────────────────────
            一条时间线，从最初的交代到最新一轮，中间不夹别的东西。
            ★ **最后一条默认展开，之前的默认收起** —— 想知道的是「现在怎么回事」，
            回头翻是偶尔的事。收起来之后，十条往来大约一屏，看得见全貌。 */}
        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-medium muted">经过</h2>
            <span className="muted text-[11px] shrink-0">管家不在线上，回复要等下一次</span>
          </div>

          <div className="mt-3 space-y-2">
            {/* 第 0 条：最初的要求。**创建时写下的，之后不改** ——
                每一轮的新要求走留言，这样「当初是怎么交代的」永远还在。 */}
            {t.detail && (
              <TimelineItem
                who="最初的要求"
                mine={false}
                main
                when={t.createdAt}
                body={t.detail}
                open={t.messages.length === 0}
              />
            )}

            {t.messages.map((m, i) => (
              <TimelineItem
                key={m.id}
                floor={i + 1}
                who={m.role === 'secretary' ? '管家' : (m.sender ?? '主人')}
                mine={m.role === 'secretary'}
                when={m.createdAt}
                body={m.content}
                open={i === t.messages.length - 1}
                pending={m.role !== 'secretary' && m.status === 'pending'}
                attachments={m.attachments}
              />
            ))}
          </div>

          {t.messages.length === 0 && !t.detail && (
            <p className="muted text-[12px] mt-3 leading-relaxed">
              还没有往来。有想问的、办事时发现的情况，都可以写在下面 ——
              管家下次会看到，回复也会出现在这里。
            </p>
          )}

          <TaskComposer taskId={t.id} defaultSender={t.owner} members={await getOwners()} />
        </section>
      </article>
    </>
  );

  return detail;
}

/**
 * 时间线上的一条。
 *
 * 短的（代办人那句「好的。」）不折叠 —— 给一句话套个「展开」反而更费事。
 * 长的收起，摘要行里留名字、日期和头一句，收着也知道这条讲什么。
 *
 * ⚠ 左边那道竖线是唯一的「谁说的」视觉线索：管家是主色，他们是灰的。
 * **刻意没做成聊天气泡** —— 一做成气泡，人就会期待秒回。
 */
function TimelineItem({
  who,
  mine,
  main,
  floor,
  when,
  body,
  open,
  pending,
  attachments,
}: {
  who: string;
  mine: boolean;
  /** 主楼 —— 当初交代的那段。渲染成一张卡片，跟下面的楼层分开。 */
  main?: boolean;
  /** 楼层号。主楼没有。 */
  floor?: number;
  when: Date;
  body: string;
  open: boolean;
  pending?: boolean;
  attachments?: { id: string; filename: string; size: number }[];
}) {
  // ★ 主楼是卡片，楼层是竖线条目 —— 两者长得一样的时候，
  // 「当初怎么交代的」和「后来聊了什么」在视觉上是平的，一眼分不出。
  const cls = main
    ? 'surface border rounded-2xl px-3.5 py-3 mb-3'
    : `rounded-r-xl pl-3 pr-1 py-2 border-l-2 ${mine ? 'border-brand-500/50' : ''}`;
  const style = main
    ? { borderColor: 'var(--border)' }
    : mine
      ? undefined
      : { borderLeftColor: 'var(--border)' };

  const head = (
    <div className="flex items-baseline gap-2 flex-wrap">
      {/* 楼层号：一眼看出这事推进了几轮。比「来回 N 条」那个抽象数字有体感。
          ⚠ 只到这一步为止 —— 不做头像、不做「回复某楼」：
          5 条多轮任务、最长 10 条往来，**一次分叉都没有**，全是一问一答。
          树状回复解决的是几十个人开几条线，不是三个人交替说话。 */}
      {floor !== undefined && (
        <span className="muted text-[11px] tabular-nums">#{floor}</span>
      )}
      <span className={`text-[11px] font-medium ${mine ? 'text-brand-700 dark:text-brand-300' : ''}`}>
        {who}
      </span>
      <span className="muted text-[11px]">{formatTime(when)}</span>
      {pending && <span className="text-[11px] text-amber-700 dark:text-amber-400">待管家处理</span>}
      {attachments && attachments.length > 0 && (
        <span className="muted text-[11px]">附件 {attachments.length}</span>
      )}
    </div>
  );

  const files = attachments && attachments.length > 0 && (
    <div className="space-y-1.5 mt-2">
      {attachments.map((a) => (
        <AttachmentRow key={a.id} id={a.id} filename={a.filename} size={a.size} />
      ))}
    </div>
  );

  if (body.length <= FOLD_OVER) {
    return (
      <div className={cls} style={style}>
        {head}
        <Prose>{body}</Prose>
        {files}
      </div>
    );
  }

  return (
    <details open={open} className={`group ${cls}`} style={style}>
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer active:opacity-60">
        {head}
        {/* 收起时显示头一句；展开后这两行让位给正文 */}
        <p className="muted text-[12px] mt-0.5 group-open:hidden leading-relaxed">{gist(body)}</p>
        <span className="text-[11px] text-brand-700 dark:text-brand-300 group-open:hidden">展开</span>
        <span className="muted text-[11px] hidden group-open:inline">收起</span>
      </summary>
      <Prose>{body}</Prose>
      {files}
    </details>
  );
}
