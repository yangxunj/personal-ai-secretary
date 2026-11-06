import type { ReactNode } from 'react';

/** Shared task card frame; navigation, metadata and actions are platform slots. */
export default function TaskCard({ title, completed, highPriority, highPriorityLabel, blocked, active, overdue, navigation, children }: {
  title: string; completed: boolean; highPriority: boolean; highPriorityLabel: string;
  blocked?: boolean; active?: boolean; overdue?: boolean; navigation?: ReactNode; children?: ReactNode;
}) {
  return <div className={`shared-task-card surface border rounded-2xl px-4 py-3.5 relative ${blocked ? 'opacity-60' : ''} ${active ? 'ring-2 ring-brand-500' : ''}`}
    style={{ borderColor: overdue ? 'rgb(248 113 113 / 0.5)' : 'var(--border)' }}>
    {navigation}
    <h3 className={`font-medium leading-snug flex items-baseline gap-1.5 ${completed ? 'line-through muted' : ''}`}>
      {highPriority && <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-red-500 translate-y-[-2px]" aria-label={highPriorityLabel} />}
      <span className="min-w-0">{title}</span>
    </h3>
    {children}
  </div>;
}
