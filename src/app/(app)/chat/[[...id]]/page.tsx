import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { Chat, type SeedMessage } from '@/components/Chat';
import ChatHeader from '@/components/chat/ChatHeader';
import ConversationList from '@/components/chat/ConversationList';
import { listConversations, newConversationId } from '@/lib/conversations';
import { formatTime } from '@/lib/format';
import { markRead } from '../../actions';

export const dynamic = 'force-dynamic';

/**
 * 对话页 —— 这一版存在的理由，也是消息的**唯一**页面。
 *
 * 主平台的沟通在 Claude Code 里进行，平台只是结果呈现层；这一版没有
 * Claude Code 那一端，所以对话必须长在网页里。
 *
 * ★ 原来这里只铺最近 12 条当上下文，完整记录另有一页（`/`，底栏叫「记录」）。
 *   那是 fork 留下的疤：主平台上「记录」是首页、是唯一的消息视图，这一版加了
 *   对话页却没敢动它，于是并排两个长得一样的页面 —— 而且在对话里说的话，
 *   附件和关联任务要跑到另一页才看得见，侧栏还没有一格是亮的。
 *   现在合并成一页：历史往上翻得到底，`/` 只剩一句 redirect。
 *
 * ★ 多个对话（像 ChatGPT 那样）：`/chat` 是新对话，`/chat/<id>` 是某一个。
 *   新对话的 id 在这里先生成好，第一句话发出去时服务端照它建（route.ts 的
 *   resolveConversation），前端同时用 history.replaceState 把地址换成
 *   /chat/<id> —— 不重新加载，useChat 手里那一轮不会丢。
 *   宽屏左边常驻对话列表；窄屏收进页头左上角的抽屉。
 */

const INCLUDE = {
  attachments: { select: { id: true, filename: true, size: true } },
  task: { select: { id: true, title: true } },
} satisfies Prisma.MessageInclude;

type MessageWithRel = Prisma.MessageGetPayload<{ include: typeof INCLUDE }>;

/** 默认只加载最近这么多条，点「查看更早」再往前翻 */
const PAGE = 60;
/** 从搜索结果定位过来时，目标消息前后各留这么多条上下文 */
const AROUND = 25;

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id?: string[] }>;
  searchParams: Promise<{ take?: string; m?: string; draft?: string }>;
}) {
  const [{ id: segs }, { take, m, draft }] = await Promise.all([params, searchParams]);

  const unread = await db.message.count({ where: { role: 'secretary', status: 'unread' } });
  if (unread > 0) await markRead();

  // 地址里的 id 库里没有（删掉了、手打错了）就当新对话 —— 用一个新 id，
  // 免得往一个已删对话的 id 上又建出一个同名的来
  const asked = segs?.[0];
  const conv = asked
    ? await db.conversation.findUnique({ where: { id: asked }, select: { id: true, title: true } })
    : null;
  const conversationId = conv?.id ?? newConversationId();
  const where = { conversationId };

  const [list, total] = await Promise.all([
    listConversations(),
    conv ? db.message.count({ where }) : Promise.resolve(0),
  ]);

  let rows: MessageWithRel[] = [];
  let focusId: string | undefined;

  // 定位模式：只取目标那一段，别把中间几百条都拉出来
  if (conv && m) {
    const target = await db.message.findFirst({ where: { id: m, conversationId }, select: { createdAt: true } });
    if (target) {
      focusId = m;
      const [before, after] = await Promise.all([
        db.message.findMany({
          where: { ...where, createdAt: { lt: target.createdAt } },
          orderBy: { createdAt: 'desc' },
          take: AROUND,
          include: INCLUDE,
        }),
        db.message.findMany({
          where: { ...where, createdAt: { gte: target.createdAt } },
          orderBy: { createdAt: 'asc' },
          take: AROUND + 1,
          include: INCLUDE,
        }),
      ]);
      rows = [...before.reverse(), ...after];
    }
  }

  // 普通模式：倒着取最近 N 条，再翻回正序显示
  const limit = Math.min(Math.max(Number(take) || PAGE, 20), 2000);
  if (conv && rows.length === 0) {
    const recent = await db.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: INCLUDE,
    });
    rows = recent.reverse();
  }

  const first = rows.at(0);
  const latest = rows.at(-1);
  const olderCount = first
    ? await db.message.count({ where: { ...where, createdAt: { lt: first.createdAt } } })
    : 0;

  // 只画最近一次压缩的线：更早那几次的分界已经被后来的摘要盖过去了
  const lastCompaction = conv
    ? await db.chatSummary.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
        select: { firstKeptId: true, summary: true, createdAt: true },
      })
    : null;

  const history: SeedMessage[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    attachments: r.attachments,
    task: r.task,
  }));

  const title = conv ? (conv.title ?? list.find((c) => c.id === conv.id)?.title ?? null) : null;

  return (
    // lg:-mb-10 抵掉 layout 给宽屏留的 pb-10：不抵的话滚到底时网格底边离视口底 40px，
    // sticky 的列表栏被它往上顶，「新对话」按钮就被切掉半截
    <div data-wide className="lg:grid lg:grid-cols-[16rem_1fr] lg:-mb-10">
      {/* 列表自己滚，对话跟着页面滚（跟任务页 TwoPane 一个道理） */}
      <aside
        className="hidden lg:block lg:h-dvh lg:sticky lg:top-0 lg:border-r"
        style={{ borderColor: 'var(--border)' }}
      >
        <ConversationList initial={list} />
      </aside>

      <div className="min-w-0">
        <ChatHeader
          key={conversationId}
          conversationId={conversationId}
          title={title}
          exists={!!conv}
          focused={!!focusId}
          list={list}
          subtitle={
            focusId
              ? `定位到这一条 · 这个对话共 ${total} 条`
              : latest
                ? `最近更新 ${formatTime(latest.createdAt)}`
                : '想到什么说什么'
          }
        />

        <div className="max-w-3xl mx-auto px-4 pt-3">
          {history.length === 0 && (
            <div className="surface border rounded-2xl p-4 mb-4" style={{ borderColor: 'var(--border)' }}>
              <p className="text-[14px] leading-relaxed">
                跟我说话就行 —— 要记的事、要存的号码、要查的东西。
              </p>
              <p className="muted text-[12px] mt-2 leading-relaxed">
                比如「下周三前把车险续了」「记住我的招行卡号是 6225…」「还有什么没办」。
              </p>
              <p className="muted text-[12px] mt-2 leading-relaxed">
                一件事一个对话，聊得清楚些；存下的资料、任务、页面在哪个对话里都查得到。
              </p>
            </div>
          )}

          <Chat
            key={conversationId}
            conversationId={conversationId}
            isNew={!conv}
            history={history}
            draft={draft}
            focusId={focusId}
            olderCount={olderCount}
            compaction={
              lastCompaction && { ...lastCompaction, createdAt: lastCompaction.createdAt.toISOString() }
            }
            olderHref={`/chat/${conversationId}?take=${focusId ? history.length + AROUND * 2 : limit + PAGE * 2}#m-${first?.id ?? ''}`}
          />
        </div>
      </div>
    </div>
  );
}
