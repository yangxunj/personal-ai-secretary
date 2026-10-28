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
import { useT } from '@/lib/i18n/client';

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
  const [titleRevision,setTitleRevision]=useState(0);
  const [canRegenerate,setCanRegenerate]=useState(false);
  const [titleBusy,setTitleBusy]=useState(false);
  const [titleFailed,setTitleFailed]=useState(false);
  const currentTitle=useRef(initialTitle);
  currentTitle.current=title;
  const requestedTitle=useRef(false);
  const t = useT();
  // 服务端重新给了一份（后退后 Chat 里那次 refresh）就跟上
  useEffect(() => setTitle(initialTitle), [initialTitle]);
  useEffect(() => setExists(initialExists), [initialExists]);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ConvEventDetail>).detail ?? {};
      if (d.id !== conversationId) return;
      if (d.title) setTitle(d.title);
      if (!d.removed) setExists(true);
      setTitleRevision(n=>n+1);
    };
    window.addEventListener(CONV_EVENT, on);
    return () => window.removeEventListener(CONV_EVENT, on);
  }, [conversationId]);

  useEffect(()=>{
    if(!exists)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{
      try {
        const response=await fetch('/api/chat/title?conversationId='+encodeURIComponent(conversationId),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),cache:'no-store'});
        if(!response.ok)return;
        const state=await response.json();if(controller.signal.aborted)return;
        setCanRegenerate(state.canRegenerate===true);
        const busy=['queued','running'].includes(state.status);setTitleBusy(busy);
        setTitleFailed(requestedTitle.current&&state.status==='failed');
        if(typeof state.title==='string'&&state.title!==currentTitle.current){currentTitle.current=state.title;setTitle(state.title);emitConversations({id:conversationId,title:state.title});}
        if(busy)timer=setTimeout(poll,2000);
      }catch{if(!controller.signal.aborted)timer=setTimeout(poll,4000);}
    };
    void poll();return()=>{controller.abort();clearTimeout(timer);};
  },[conversationId,exists,titleRevision]);

  async function regenerateTitle() {
    setTitleBusy(true);setTitleFailed(false);requestedTitle.current=true;
    try {
      const response=await fetch('/api/chat/title',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId})});
      if(!response.ok)throw new Error('Title request failed');
      setTitleRevision(n=>n+1);
    }catch{setTitleBusy(false);setTitleFailed(true);}
  }

  return (
    <header className="sticky top-0 z-20 surface border-b pt-safe" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2 pl-2 pr-4 lg:pl-4 h-14">
        <div className="flex items-center gap-1 min-w-0">
          <button
            onClick={() => setDrawer(true)}
            aria-label={t('对话列表')}
            className="lg:hidden h-9 w-9 shrink-0 flex items-center justify-center rounded-lg muted active:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>
          <div className="min-w-0">
            <h1 className="font-semibold truncate">{title ?? t('新对话')}</h1>
            <p className="muted text-[11px] -mt-0.5 truncate">{titleBusy?t('正在整理对话标题…'):titleFailed?t('标题未更新，原名已保留，可稍后重试。'):subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {focused && (
            <Link
              href={`/chat/${conversationId}`}
              className="muted text-xs px-2.5 py-1.5 rounded-lg border"
              style={{ borderColor: 'var(--border)' }}
            >
              {t('回到最新')}
            </Link>
          )}
          {exists && <ConversationMenu id={conversationId} title={title ?? ''} onRenamed={setTitle} canRegenerate={canRegenerate} titleBusy={titleBusy} onRegenerate={regenerateTitle} />}
          <Link
            href="/chat"
            aria-label={t('新对话')}
            title={t('新对话')}
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
function ConversationMenu({ id, title, onRenamed,canRegenerate,titleBusy,onRegenerate }: { id: string; title: string; onRenamed: (t: string) => void;canRegenerate:boolean;titleBusy:boolean;onRegenerate:()=>Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'rename' | 'confirm'>('menu');
  const [draft, setDraft] = useState(title);
  const [pending, start] = useTransition();
  const [menuLeft, setMenuLeft] = useState<number>();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = box.current?.getBoundingClientRect();
      if (rect) setMenuLeft(Math.max(8 - rect.left, rect.width - 240));
    };
    place();
    window.addEventListener('resize', place);
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('resize', place);
    };
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
        aria-label={t('对话操作')}
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
          style={{ borderColor: 'var(--border)', ...(menuLeft === undefined ? {} : { left: menuLeft, right: 'auto' }) }}
        >
          {mode === 'menu' && (
            <>
              <button className={item} onClick={() => setMode('rename')}>
                {t('改个名字')}
              </button>
              {canRegenerate&&<button className={item} disabled={titleBusy} onClick={()=>{setOpen(false);void onRegenerate();}}>{t('重新生成标题')}</button>}
              <button className={`${item} text-red-600 dark:text-red-400`} onClick={() => setMode('confirm')}>
                {t('删除这个对话')}
              </button>
            </>
          )}

          {mode === 'rename' && (
            <form
              className="p-1.5 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = draft.trim();
                if (!name) return;
                start(async () => {
                  await renameConversation(id, name);
                  onRenamed(name);
                  emitConversations({ id, title: name });
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
                  {t('取消')}
                </button>
                <button
                  disabled={pending}
                  className="text-[12px] px-3 py-1 rounded-lg bg-brand-500 text-white disabled:opacity-50"
                >
                  {t('保存')}
                </button>
              </div>
            </form>
          )}

          {mode === 'confirm' && (
            <div className="p-2 space-y-2">
              <p className="text-[12px] leading-relaxed muted">
                {t('聊天记录会删掉。在对话里建的任务、存的资料、传的文件、做的页面都还在。')}
              </p>
              <div className="flex justify-end gap-1.5">
                <button onClick={() => setOpen(false)} className="text-[12px] px-2.5 py-1 muted">
                  {t('取消')}
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
                  {pending ? t('删除中…') : t('确定删除')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
