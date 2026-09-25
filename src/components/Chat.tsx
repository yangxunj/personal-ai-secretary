'use client';

import Link from 'next/link';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import MessageBody from '@/components/MessageBody';
import { isModelImage, unreadableReason } from '@/lib/file-support';
import { formatTime, dayLabel, sameDay, humanSize } from '@/lib/format';
import { titleConversation } from '@/app/(app)/chat/actions';
import { emitConversations } from '@/components/chat/events';

/** 工具名 → 人话。工具卡片上显示它，用户不该看见 createTask 这种字眼 */
const TOOL_LABELS: Record<string, string> = {
  createTask: '记下待办',
  listTasks: '翻了翻待办',
  updateTask: '更新待办',
  addVaultItem: '存进资料库',
  searchVault: '查资料库',
  saveNote: '留了个档',
  saveFile: '归档文件',
  importBill: '读账单入库',
  importHealthReport: '读体检报告入库',
  queryFinance: '查账',
  queryHealth: '查体检记录',
  queryPolicies: '查保单',
  listPages: '翻了翻页面',
  getPage: '取回页面',
  savePage: '做页面',
  restorePageVersion: '退回上一版',
};

function toolLabel(type: string) {
  const name = type.replace(/^tool-/, '');
  return TOOL_LABELS[name] ?? name;
}

/** 单张图最大 10MB。手机原图动辄 5-8MB，再大就该先压一压 */
const MAX_BYTES = 10 * 1024 * 1024;

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * 工具调用卡片。
 *
 * 做得很轻：一行字 + 状态点。用户要知道「它刚动了库里的东西」，
 * 但不需要看见参数 JSON —— 那是调试信息，铺在对话里只会让人不敢往下读。
 *
 * 唯一的例外是 warnings：读账单读漏一笔、余额对不上，这些必须顶到台面上。
 * **不能让「没验」和「验过了」在页面上看起来一样。**
 */
function ToolCard({ label, state, output }: { label: string; state: string; output?: unknown }) {
  const done = state === 'output-available';
  const failed = state === 'output-error';
  const warnings =
    output && typeof output === 'object' && Array.isArray((output as { warnings?: unknown }).warnings)
      ? ((output as { warnings: unknown[] }).warnings as string[])
      : [];
  // 做完页面直接给个入口 —— 别让人去回复正文里找那个链接
  const pageUrl =
    done && output && typeof output === 'object' && typeof (output as { url?: unknown }).url === 'string'
      ? (output as { url: string }).url
      : null;

  return (
    <div className="space-y-1.5">
      <div
        className="inline-flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1 border"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className={failed ? 'text-red-500' : done ? 'text-emerald-500' : 'muted animate-pulse'}>
          {failed ? '✕' : done ? '✓' : '⋯'}
        </span>
        <span className="muted">{label}</span>
      </div>
      {pageUrl && (
        <Link href={pageUrl} className="ml-1.5 text-[11px] text-brand-600 dark:text-brand-300 hover:underline">
          打开页面 →
        </Link>
      )}
      {warnings.length > 0 && (
        <ul className="text-[11px] leading-relaxed rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 space-y-1">
          {warnings.map((w, i) => (
            <li key={i} className="text-amber-600 dark:text-amber-400">
              ⚠ {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 思考过程：默认折起来。想看的人点开，不想看的人不受打扰 */
function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="text-[11px]">
      <button onClick={() => setOpen((v) => !v)} className="muted hover:underline">
        {open ? '收起思考过程' : `思考过程（${text.length} 字）`}
      </button>
      {open && (
        <pre
          className="mt-1.5 whitespace-pre-wrap break-words muted leading-relaxed p-2.5 rounded-lg border"
          style={{ borderColor: 'var(--border)' }}
        >
          {text}
        </pre>
      )}
    </div>
  );
}

export type SeedMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  attachments?: { id: string; filename: string; size: number }[];
  task?: { id: string; title: string } | null;
};

/** 最近一次上下文压缩：它保留的第一条原文 + 摘要 */
export type Compaction = { firstKeptId: string; summary: string; createdAt: string };

export function Chat({
  conversationId,
  isNew = false,
  history,
  focusId,
  olderCount = 0,
  olderHref,
  compaction,
  draft,
}: {
  /** 这是哪个对话。新对话的 id 是页面上先生成的，第一句话发出去时服务端才建 */
  conversationId: string;
  /** 库里还没有这个对话（地址还是 /chat） */
  isNew?: boolean;
  /** 输入框预填的一句话（页面墙上的示例、「用最新数据重做」带过来的） */
  draft?: string;
  /** 最近一次压缩。有的话在它保留的第一条前面画一道线，点开能看摘要 */
  compaction?: Compaction | null;
  /** 库里已有的记录，正序。这就是完整记录 —— 不再另有一页。 */
  history: SeedMessage[];
  /** 从搜索结果定位过来时高亮并滚到这一条 */
  focusId?: string;
  olderCount?: number;
  olderHref?: string;
}) {
  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      // 只发这一轮的新消息：历史由服务端从数据库拼（含压缩后的摘要）。
      // 发整串的话，刷新前后模型看到的上下文就不一样了。
      prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages.at(-1), conversationId } }),
    }),
    onFinish: ({ message, messages, isError }) => {
      // 列表跟着挪：这个对话刚说过话，排到最上面
      emitConversations();
      if (isError || !needsTitle.current) return;
      needsTitle.current = false;
      // 第一轮聊完起个标题。用这一轮的原文，不从库里读（见 lib/conversations.ts）
      const user = messages.findLast((x) => x.role === 'user');
      titleConversation(conversationId, textOf(user?.parts), textOf(message.parts))
        .then((title) => title && emitConversations({ id: conversationId, title }))
        .catch(() => {});
    },
  });
  const router = useRouter();
  const pathname = usePathname();
  // 浏览器「后退」回到一个新开过的对话时，地址栏是 /chat/<那个 id>（当初
  // replaceState 换的），可 Next 按路由结构恢复页面，拿的是 /chat 这个路由
  // **最近一次**的渲染 —— 也就是后来又点的那个空白新对话。于是地址写着 A，
  // 页面是空白的 B。认出「我是空白新对话、地址却指着别的对话」就照地址去一趟。
  // 第一句话发出去后地址是 /chat/<自己的 id>，不会误伤。
  useEffect(() => {
    if (isNew && pathname.startsWith('/chat/') && pathname !== `/chat/${conversationId}`) router.replace(pathname);
  }, [isNew, pathname, conversationId, router]);
  /** 还没聊过的对话，第一轮结束后要起标题 */
  const needsTitle = useRef(history.length === 0);
  const addressed = useRef(!isNew);
  const [input, setInput] = useState(draft ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const landed = useRef(false);
  const busy = status === 'submitted' || status === 'streaming';

  // 首屏落点：定位模式滚到那一条并居中；「查看更早」带着 #m-xxx 回来时
  // 让浏览器停在原来那条上；其余情况直接到最新。
  // ⚠ 首屏要 instant —— smooth 会让人眼睁睁看着几百条飞过去。
  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    if (focusId) {
      const el = document.getElementById(`m-${focusId}`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
        return;
      }
    }
    if (window.location.hash) return;
    // 空白的新对话别往下滚：上面那张「跟我说话就行」的卡片会被顶出屏幕
    if (history.length === 0) return;
    bottom.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
  }, [focusId]);

  // 本次对话新来的内容才跟着滚
  useEffect(() => {
    if (!landed.current || messages.length === 0) return;
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const tooBig = incoming.filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) {
      setNote(`${tooBig.map((f) => f.name).join('、')} 超过 10MB，先压一下再传`);
    } else {
      setNote('');
    }
    const ok = incoming.filter((f) => f.size <= MAX_BYTES);
    if (ok.length) setFiles((prev) => [...prev, ...ok].slice(0, 6));
  }

  async function send() {
    const text = input.trim();
    if ((!text && !files.length) || busy) return;

    const attached = files.length
      ? await Promise.all(
          files.map(async (f) => ({
            type: 'file' as const,
            url: await readAsDataUrl(f),
            mediaType: f.type || 'application/octet-stream',
            filename: f.name,
          }))
        )
      : undefined;

    // 只传了图没配话时给一句默认的：模型收到一条空消息不知道该干嘛
    const said = text || (attached ? '看看这个' : '');
    sendMessage({ text: said, files: attached });

    // 新对话的第一句：地址换成 /chat/<id>（不重新加载，这一轮不能断），
    // 列表先乐观地放一条上去，标题等这一轮聊完再起
    if (!addressed.current) {
      addressed.current = true;
      window.history.replaceState(null, '', `/chat/${conversationId}`);
      emitConversations({ id: conversationId, title: [...said].slice(0, 20).join(''), provisional: true });
    }
    setInput('');
    setFiles([]);
    setNote('');
  }

  return (
    <div
      className="flex flex-col min-h-[calc(100dvh-8.5rem)] lg:min-h-[calc(100dvh-5.5rem)]"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex-1 space-y-4 pb-4">
        {olderCount > 0 && olderHref && (
          <div className="text-center">
            <Link
              href={olderHref}
              className="muted text-xs px-4 py-2 rounded-full border inline-block"
              style={{ borderColor: 'var(--border)' }}
            >
              还有 {olderCount} 条更早的 · 查看更早
            </Link>
          </div>
        )}

        {/* 库里的记录。读得到「上次说到哪」，这个秘书才是连续的 */}
        {history.map((m, i) => {
          const prev = history[i - 1];
          const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
          return (
            <div key={m.id}>
              {newDay && <DayDivider label={dayLabel(m.createdAt)} />}
              {compaction?.firstKeptId === m.id && <CompactionDivider c={compaction} />}
              <HistoryItem msg={m} focused={m.id === focusId} />
            </div>
          );
        })}

        {history.length > 0 && messages.length > 0 && (
          <div className="flex items-center gap-2 py-1">
            <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
            <span className="muted text-[10px]">以下是本次对话</span>
            <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
          </div>
        )}

        {messages.map((m) => (
          <Bubble key={m.id} role={m.role === 'user' ? 'user' : 'assistant'}>
            <div className="space-y-2">
              {m.parts.map((p, i) => {
                if (p.type === 'text') return <MessageBody key={i}>{p.text}</MessageBody>;
                if (p.type === 'reasoning') return <Reasoning key={i} text={p.text} />;
                if (p.type === 'file') {
                  return p.mediaType?.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={p.url}
                      alt={p.filename ?? '图片'}
                      className="rounded-lg max-h-56 w-auto"
                    />
                  ) : (
                    <div key={i} className="text-[12px] opacity-80">
                      📎 {p.filename ?? '文件'}
                    </div>
                  );
                }
                if (p.type.startsWith('tool-') || p.type === 'dynamic-tool') {
                  const state = 'state' in p ? String(p.state) : '';
                  const output = 'output' in p ? p.output : undefined;
                  return <ToolCard key={i} label={toolLabel(p.type)} state={state} output={output} />;
                }
                return null;
              })}
            </div>
          </Bubble>
        ))}

        {status === 'submitted' && (
          <Bubble role="assistant">
            <span className="muted text-sm animate-pulse">…</span>
          </Bubble>
        )}

        {error && (
          <div className="text-[12px] text-red-500 px-1">
            出错了：{error.message}
            <button onClick={() => location.reload()} className="ml-2 underline">
              刷新重试
            </button>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {/* 输入区固定在底栏上方。宽屏没有底栏，贴到窗口底边。 */}
      <div
        className="sticky bottom-[calc(4.4rem+env(safe-area-inset-bottom,0px))] lg:bottom-0 -mx-4 px-4 py-2.5 border-t backdrop-blur"
        style={{
          borderColor: dragging ? 'var(--brand-500, #6366f1)' : 'var(--border)',
          // 跟着主题走的半透明背景。原来写的 var(--bg-blur, 白) 那个变量从没定义过，深色下一片白
          background: 'color-mix(in srgb, var(--bg) 85%, transparent)',
        }}
      >
        {/* 待发送的附件。发出去之前一直看得见、点得掉 —— 传错一张图不该只能整条重来 */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {files.map((f, i) => {
              const bad = unreadableReason(f.type, f.name);
              return (
              <div
                key={i}
                title={bad ?? undefined}
                className={`relative rounded-lg border overflow-hidden ${bad ? 'border-amber-500' : ''}`}
                style={bad ? undefined : { borderColor: 'var(--border)' }}
              >
                {/* 只给浏览器画得出来的格式出缩略图 —— HEIC 在 Windows 的浏览器里是一个裂图 */}
                {isModelImage(f.type) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={URL.createObjectURL(f)} alt={f.name} className="h-16 w-16 object-cover" />
                ) : (
                  <div className="h-16 w-24 px-1.5 flex items-center justify-center text-[10px] muted text-center break-all">
                    {f.name}
                  </div>
                )}
                <button
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute top-0 right-0 bg-black/55 text-white w-5 h-5 text-[11px] leading-5 text-center"
                  aria-label="移除"
                >
                  ×
                </button>
                {/* 选的时候就说清楚，别等 AI 回一句「读不了」才知道 —— 那一轮白花钱 */}
                {bad && (
                  <div className="absolute bottom-0 inset-x-0 bg-amber-500 text-white text-[10px] leading-4 text-center">
                    AI 读不了
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
        {files.some((f) => unreadableReason(f.type, f.name)) && (
          <div className="text-[11px] text-amber-600 dark:text-amber-400 mb-1.5 leading-relaxed">
            {[...new Set(files.map((f) => unreadableReason(f.type, f.name)).filter(Boolean))].map((r) => (
              <p key={r}>{r}</p>
            ))}
          </div>
        )}
        {note && <div className="text-[11px] text-amber-600 mb-1.5">{note}</div>}

        <div className="flex items-end gap-2">
          <input
            ref={picker}
            type="file"
            multiple
            accept="image/*,application/pdf,.docx,.xlsx,.txt,.csv,.json"
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => picker.current?.click()}
            className="shrink-0 rounded-full w-10 h-10 border text-lg muted"
            style={{ borderColor: 'var(--border)' }}
            aria-label="添加文件"
          >
            +
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              // 截图直接 Ctrl+V 贴进来 —— 桌面上这是最顺手的传图方式
              const pasted = Array.from(e.clipboardData.files);
              if (pasted.length) {
                e.preventDefault();
                addFiles(pasted);
              }
            }}
            onKeyDown={(e) => {
              // 手机上回车就是换行，别抢；桌面上 Enter 发送、Shift+Enter 换行
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={files.length ? '说说这是什么（可留空）…' : '跟我说点什么，也可以传张图…'}
            className="flex-1 resize-none rounded-2xl border px-3.5 py-2.5 text-[15px] bg-transparent outline-none focus:border-brand-500 transition max-h-32"
            style={{ borderColor: 'var(--border)' }}
          />
          {busy ? (
            <button
              onClick={stop}
              className="shrink-0 rounded-full w-10 h-10 border text-sm"
              style={{ borderColor: 'var(--border)' }}
              aria-label="停止"
            >
              ■
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim() && !files.length}
              className="shrink-0 rounded-full w-10 h-10 bg-brand-500 text-white disabled:opacity-30 transition"
              aria-label="发送"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
      <span className="muted text-[11px]">{label}</span>
      <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
    </div>
  );
}

/**
 * 库里的一条记录：气泡 + 附件 + 关联任务 + 时间。
 *
 * 跟本次对话的气泡长得一样，但多挂三样东西 —— 这三样原来只在「记录」页有，
 * 所以在对话里发的附件，必须切到另一页才看得见。合并就是为了这个。
 */
function HistoryItem({ msg, focused }: { msg: SeedMessage; focused: boolean }) {
  const mine = msg.role === 'user';
  return (
    <div id={`m-${msg.id}`} className={`scroll-mt-20 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[85%] min-w-0 rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed break-words ${
          mine ? 'bg-brand-500 text-white rounded-br-md' : 'surface border rounded-bl-md'
        } ${focused ? 'ring-2 ring-brand-400 ring-offset-2 ring-offset-transparent' : ''}`}
        style={mine ? undefined : { borderColor: 'var(--border)' }}
      >
        <MessageBody>{msg.content}</MessageBody>
      </div>

      {!!msg.attachments?.length && (
        <div className="mt-1.5 space-y-1.5 max-w-[85%]">
          {msg.attachments.map((a) => (
            <a
              key={a.id}
              href={`/api/files/${a.id}`}
              target="_blank"
              className="flex items-start gap-2.5 surface border rounded-xl px-3 py-2 active:opacity-70 transition"
              style={{ borderColor: 'var(--border)' }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
              </svg>
              <span className="text-sm break-all">{a.filename}</span>
              <span className="muted text-xs shrink-0">{humanSize(a.size)}</span>
            </a>
          ))}
        </div>
      )}

      {msg.task && (
        <Link
          href={`/tasks/${msg.task.id}`}
          className="mt-1.5 text-xs px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-100"
        >
          关联任务：{msg.task.title}
        </Link>
      )}

      <span className="muted text-[11px] mt-1 px-1">{formatTime(msg.createdAt)}</span>
    </div>
  );
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }) {
  const mine = role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] min-w-0 rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed break-words ${
          mine ? 'bg-brand-500 text-white rounded-br-md' : 'surface border rounded-bl-md'
        }`}
        style={mine ? undefined : { borderColor: 'var(--border)' }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 上下文压缩的分界线。
 *
 * 线上面的对话，AI 已经只记得摘要了 —— 页面上照样能翻到原文，但它看不到。
 * 不画出来的话，用户会以为它记得全部，问一句三周前的细节，它答不上来就显得莫名其妙。
 * 摘要默认收起：它是给 AI 看的，平时不用管，想知道「它到底记得什么」时再点开。
 */
function CompactionDivider({ c }: { c: Compaction }) {
  return (
    <details className="my-3 group">
      <summary className="list-none cursor-pointer select-none flex items-center gap-2 py-1">
        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
        <span className="muted text-[11px] whitespace-nowrap">
          ↑ 以上的对话 AI 只记得摘要 · <span className="underline underline-offset-2">看摘要</span>
        </span>
        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
      </summary>
      <div
        className="mt-2 surface border rounded-xl px-4 py-3 text-[13px]"
        style={{ borderColor: 'var(--border)' }}
      >
        <p className="muted text-[11px] mb-2">
          {formatTime(c.createdAt)} 整理 · 对话太长时，早期内容会自动整理成这份摘要，
          之后 AI 记得的是「摘要 + 这条线以下的原文」
        </p>
        <MessageBody>{c.summary}</MessageBody>
      </div>
    </details>
  );
}

/** 一条 UI 消息里的正文（不含工具调用、推理过程） */
function textOf(parts?: { type: string; text?: string }[]) {
  return (parts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();
}
