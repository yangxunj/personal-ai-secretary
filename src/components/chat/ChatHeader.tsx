'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import ThemeToggle from '@/components/ThemeToggle';
import { SearchLink, SettingsLink } from '@/components/PageHeader';
import { deleteConversation, renameConversation } from '@/app/(app)/chat/actions';
import type { ConversationItem } from '@/lib/conversations';
import ConversationList from './ConversationList';
import { CONV_EVENT, emitConversations, type ConvEventDetail } from './events';

/**
 * 对话页的页头：标题 + 「⋯」（改名、删除）+ 新对话。
 *
 * 窄屏上没有左边那一栏列表，左上角一个按钮拉出抽屉。
 * 宽屏上列表常驻，这里就不重复放「新对话」了。
 */
export default function ChatHeader({
  conversationId,
  title: initialTitle,
  subtitle,
  exists: initialExists,
  focused,
  list,
}: {
  conversationId: string;
  title: string | null;
  subtitle: string;
  /** 库里已经有这个对话了（新对话在第一句话发出去之前是没有的） */
  exists: boolean;
  /** 从搜索结果定位过来的 */
  focused: boolean;
  list: ConversationItem[];
}) {
  const [title, setTitle] = useState(initialTitle);
  const [exists, setExists] = useState(initialExists);
  const [drawer, setDrawer] = useState(false);
  // 服务端重新给了一份（后退后 Chat 里那次 refresh）就跟上
  useEffect(() => setTitle(initialTitle), [initialTitle]);
  useEffect(() => setExists(initialExists), [initialExists]);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ConvEventDetail>).detail ?? {};
      if (d.id !== conversationId) return;
      if (d.title) setTitle(d.title);
      if (!d.removed) setExists(true);
    };
    window.addEventListener(CONV_EVENT, on);
    return () => window.removeEventListener(CONV_EVENT, on);
  }, [conversationId]);

  return (
    <header className="sticky top-0 z-20 surface border-b pt-safe" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2 pl-2 pr-4 lg:pl-4 h-14">
        <div className="flex items-center gap-1 min-w-0">
          <button
            onClick={() => setDrawer(true)}
            aria-label="对话列表"
            className="lg:hidden h-9 w-9 shrink-0 flex items-center justify-center rounded-lg muted active:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="font-semibold truncate">{title ?? '新对话'}</h1>
            <p className="muted text-[11px] -mt-0.5 truncate">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {focused && (
            <Link
              href={`/chat/${conversationId}`}
              className="muted text-xs px-2.5 py-1.5 rounded-lg border"
              style={{ borderColor: 'var(--border)' }}
            >
              回到最新
            </Link>
          )}
          {exists && <ConversationMenu id={conversationId} title={title ?? ''} onRenamed={setTitle} />}
          <Link
            href="/chat"
            aria-label="新对话"
            title="新对话"
            className="lg:hidden h-9 w-9 flex items-center justify-center rounded-lg muted active:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </Link>
          {/* 宽屏上这三个在侧栏底部，见 PageHeader 里的说明 */}
          <span className="contents lg:hidden">
            <ThemeToggle />
            <SearchLink />
            <SettingsLink />
          </span>
        </div>
      </div>

      {/* 抽屉挂到 body 上：留在 header 里的话会被它的 z-20 困住，底栏压在抽屉上面 */}
      {drawer && createPortal(
        <div className="lg:hidden fixed inset-0 z-50" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute inset-y-0 left-0 w-[82%] max-w-xs surface border-r pt-safe shadow-xl"
            style={{ borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <ConversationList initial={list} onNavigate={() => setDrawer(false)} />
          </div>
        </div>,
        document.body,
      )}
    </header>
  );
}

/** 「⋯」：改名、删除。删除两步确认，第二步才是红的（跟附件、页面一个规矩） */
function ConversationMenu({ id, title, onRenamed }: { id: string; title: string; onRenamed: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'rename' | 'confirm'>('menu');
  const [draft, setDraft] = useState(title);
  const [pending, start] = useTransition();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const item = 'block w-full text-left px-3 py-2 text-[13px] rounded-lg hover:bg-brand-500/5 transition';

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          setMode('menu');
          setDraft(title);
        }}
        aria-label="对话操作"
        className="h-9 w-9 flex items-center justify-center rounded-lg muted active:opacity-60 hover:bg-brand-500/5"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-11 z-30 w-60 surface border rounded-xl p-1.5 shadow-lg"
          style={{ borderColor: 'var(--border)' }}
        >
          {mode === 'menu' && (
            <>
              <button className={item} onClick={() => setMode('rename')}>
                改个名字
              </button>
              <button className={`${item} text-red-600 dark:text-red-400`} onClick={() => setMode('confirm')}>
                删除这个对话
              </button>
            </>
          )}

          {mode === 'rename' && (
            <form
              className="p-1.5 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const t = draft.trim();
                if (!t) return;
                start(async () => {
                  await renameConversation(id, t);
                  onRenamed(t);
                  emitConversations({ id, title: t });
                  setOpen(false);
                });
              }}
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={60}
                className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] bg-transparent outline-none focus:border-brand-500"
                style={{ borderColor: 'var(--border)' }}
              />
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setOpen(false)} className="text-[12px] px-2.5 py-1 muted">
                  取消
                </button>
                <button
                  disabled={pending}
                  className="text-[12px] px-3 py-1 rounded-lg bg-brand-500 text-white disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </form>
          )}

          {mode === 'confirm' && (
            <div className="p-2 space-y-2">
              <p className="text-[12px] leading-relaxed muted">
                聊天记录会删掉。在对话里建的任务、存的资料、传的文件、做的页面都还在。
              </p>
              <div className="flex justify-end gap-1.5">
                <button onClick={() => setOpen(false)} className="text-[12px] px-2.5 py-1 muted">
                  取消
                </button>
                <button
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await deleteConversation(id);
                      emitConversations({ id, removed: true });
                      router.push('/chat');
                    })
                  }
                  className="text-[12px] px-3 py-1 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 font-medium disabled:opacity-50"
                >
                  {pending ? '删除中…' : '确定删除'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
