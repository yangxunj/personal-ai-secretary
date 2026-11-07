import { useEffect, type ReactNode } from 'react';

/** Shared mobile conversation drawer; storage and navigation stay with the caller. */
export default function ConversationDrawer({ open, onClose, children, mobileOnly = false, label, closeLabel }: {
  open: boolean; onClose: () => void; children: ReactNode; mobileOnly?: boolean; label: string; closeLabel: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return <div className={`${mobileOnly ? 'lg:hidden ' : ''}fixed inset-0 z-50`} style={{ display: open ? undefined : 'none' }} aria-hidden={!open}>
    <div className="absolute inset-0 bg-black/40" onClick={onClose} data-drawer-backdrop="true" />
    <div role="dialog" aria-modal="true" aria-label={label}
      className="absolute inset-y-0 left-0 w-[82%] max-w-xs surface border-r pt-safe shadow-xl flex flex-col"
      style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between px-3 pt-2 shrink-0">
        <span className="font-semibold">{label}</span>
        <button type="button" onClick={onClose} aria-label={closeLabel} className="h-10 w-10 flex items-center justify-center rounded-lg muted">✕</button>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  </div>;
}
