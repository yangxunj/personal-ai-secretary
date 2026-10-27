'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Chat } from '@/components/Chat';
import { loadTaskChat } from '@/app/(app)/tasks/chat-actions';
import { useT } from '@/lib/i18n/client';

export default function TaskChatDialog({ taskId, title, initiallyOpen = false }: {
  taskId: string; title: string; initiallyOpen?: boolean;
}) {
  const t = useT(); const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false), [open, setOpen] = useState(initiallyOpen);
  const [data, setData] = useState<Awaited<ReturnType<typeof loadTaskChat>> | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const requested = useRef(false);
  const refresh = useCallback(async () => {
    const next = await loadTaskChat(taskId);
    setData(next); router.refresh();
  }, [taskId, router]);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true; setLoading(true);
    loadTaskChat(taskId).then(setData).catch(e => {
      setError(e instanceof Error ? e.message : String(e)); requested.current = false;
    }).finally(() => setLoading(false));
  }, [open, taskId]);
  useEffect(() => {
    if (!initiallyOpen) return;
    const url = new URL(window.location.href); url.searchParams.delete('chat');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [initiallyOpen]);
  useEffect(() => {
    if (!open || !mounted) return;
    closeButton.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); setOpen(false); router.refresh(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); trigger.current?.focus({ preventScroll: true }); };
  }, [open, mounted, router]);

  const panelId = 'task-chat-' + taskId;
  return <>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={panelId}
      onClick={() => { setError(''); setOpen(true); if(data)void refresh().catch(e => setError(String(e))); }}
      className="mt-4 block w-full text-left rounded-xl bg-brand-500/10 px-4 py-3 text-sm text-brand-700 dark:text-brand-300">
      {t('和 AI 聊这件任务')}
    </button>
    {mounted && (open || data) && createPortal(
      <section id={panelId} role="dialog" aria-labelledby={panelId + '-title'} hidden={!open}
        className="fixed z-50 bottom-0 right-0 h-[72dvh] max-h-[720px] w-full md:bottom-6 md:right-6 md:w-[440px] max-w-full surface border rounded-t-2xl md:rounded-2xl text-[var(--text)] shadow-2xl">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-t-2xl md:rounded-2xl">
          <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div className="min-w-0 flex-1"><h2 id={panelId + '-title'} className="text-base font-semibold">{t('任务 AI 对话')}</h2>
              <p className="muted text-xs mt-1 truncate" title={title}>{title}</p></div>
            <button ref={closeButton} type="button" onClick={() => { setOpen(false); router.refresh(); }}
              aria-label={t('关闭任务聊天')} className="shrink-0 rounded-lg px-3 py-2 text-sm hover:bg-brand-500/10">{t('收起')}</button>
          </header>
          {loading && <p className="p-4 muted text-sm">{t('正在读取任务对话…')}</p>}
          {error && <p className="p-4 text-red-500 text-sm">{error}</p>}
          {data && <>
            <div className="flex-1 min-h-0">
              <Chat key={data.id} conversationId={data.id} taskId={taskId} embedded active={open} history={data.history}
                olderCount={data.older} backend={data.backend} pending={data.pending} lastError={data.lastError} onReply={refresh} />
            </div>
          </>}
        </div>
      </section>, document.body)}
  </>;
}
