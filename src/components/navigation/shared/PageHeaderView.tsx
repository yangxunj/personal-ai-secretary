import type { ReactNode } from 'react';

export default function PageHeaderView({ title, subtitle, back, actions }: {
  title: string; subtitle?: string; back?: ReactNode; actions?: ReactNode;
}) {
  return <header className="sticky top-0 z-20 surface border-b pt-safe" style={{ borderColor: 'var(--border)' }}>
    <div className={`flex items-center justify-between h-14 ${back ? 'pl-1 pr-4' : 'px-4'}`}>
      <div className="flex items-center gap-1 min-w-0">{back}<div className="min-w-0">
        <h1 className="font-semibold truncate">{title}</h1>
        {subtitle && <p className="muted text-[11px] -mt-0.5 truncate">{subtitle}</p>}
      </div></div>
      <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
    </div>
  </header>;
}
