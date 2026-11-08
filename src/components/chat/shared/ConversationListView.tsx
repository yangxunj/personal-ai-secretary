import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { groupConversationItems, type ConversationListItem } from './conversation-list';

export type ConversationNavigation = { id: string | null; title?: string; current?: boolean; className: string; style?: CSSProperties; children: ReactNode };
export default function ConversationListView({ items, activeId, t, disabled = false, onSelect, onNew, onDelete, renderNavigation }: {
  items: ConversationListItem[]; activeId: string | null; t: (key: string) => string; disabled?: boolean;
  onSelect?: (id: string) => void; onNew?: () => void;
  onDelete?: (id: string) => void;
  renderNavigation?: (navigation: ConversationNavigation) => ReactNode;
}) {
  const navigation = (props: ConversationNavigation) => renderNavigation ? renderNavigation(props) : (
    <button type="button" disabled={disabled} onClick={() => { if (!disabled) { if (props.id === null) onNew?.(); else onSelect?.(props.id); } }}
      title={props.title} style={props.style} aria-current={props.current ? 'page' : undefined} className={`${props.className} w-full text-left bg-transparent disabled:opacity-50`} data-conversation-id={props.id ?? ''}>
      {props.children}
    </button>
  );
  const conversationNavigation = (item: ConversationListItem) => navigation({ id: item.id, title: item.title, current: item.id === activeId,
    className: `block truncate rounded-lg px-2.5 py-2 text-[13.5px] transition ${item.id === activeId ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300 font-medium' : 'hover:bg-brand-500/5'} ${item.provisional && item.id !== activeId ? 'muted' : ''}`,
    children: item.title });
  return <div className="flex flex-col h-full">
    <div className="px-3 pt-3 pb-2 shrink-0">
      {navigation({ id: null, style: { borderColor: 'var(--border)' }, className: 'flex items-center justify-center gap-2 w-full rounded-xl border px-3 py-2.5 text-[14px] font-medium hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-300 transition', children: <>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>{t('新对话')}
      </> })}
    </div>
    <div className="flex-1 overflow-y-auto px-2 pb-4">
      {items.length === 0 && <p className="muted text-[12px] text-center py-8">{t('还没有对话')}</p>}
      {groupConversationItems(items, t).map(([label, rows]) => <div key={label} className="mt-3 first:mt-1">
        <p className="muted text-[11px] font-medium px-2.5 mb-1">{label}</p>
        {rows.map(item => <Fragment key={item.id}>{onDelete ? <div className="shared-conversation-row">{conversationNavigation(item)}<button type="button" disabled={disabled} className="shared-conversation-delete" aria-label={`${t('删除对话')}：${item.title}`} onClick={() => onDelete(item.id)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 3v7m4-7v7" /></svg>
          </button></div> : conversationNavigation(item)}</Fragment>)}
      </div>)}
    </div>
  </div>;
}
