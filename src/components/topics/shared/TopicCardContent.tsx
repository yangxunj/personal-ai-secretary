import type { ReactNode } from 'react';

/** Platform-neutral content for a topic card; callers provide navigation. */
export default function TopicCardContent({ title, summary, category, badge, metadata }: {
  title: string; summary?: string | null; category: string; badge?: ReactNode; metadata?: ReactNode;
}) {
  return <>
    <div className="flex items-start justify-between gap-3">
      <h3 className="font-medium leading-snug">{title}</h3>
      {badge}
    </div>
    {summary && <p className="muted text-sm mt-1.5 leading-relaxed">{summary}</p>}
    <div className="flex items-center gap-2 mt-3 muted text-[11px] flex-wrap">
      <span className="px-2 py-0.5 rounded-md" style={{ background: 'var(--bg)' }}>{category}</span>
      {metadata}
    </div>
  </>;
}
