'use client';

export default function TaskOwnerSelect({ owner, members, disabled, onChange, t, className = '' }: {
  owner: string | null; members: string[]; disabled?: boolean; onChange: (value: string | null) => void;
  t: (text: string) => string; className?: string;
}) {
  return <span className={`relative z-[2] inline-flex items-center ${className}`}>
    <select value={owner ?? ''} disabled={disabled} onChange={event => onChange(event.target.value || null)} aria-label={t('负责人')}
      className={`chip-select rounded-lg border pl-6 pr-6 py-1.5 active:opacity-60 disabled:opacity-50 ${
        owner ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300 font-medium' : 'muted'}`}
      style={{ borderColor: 'var(--border)' }}>
      {[...new Set([...members, ...(owner ? [owner] : []), ''])].map(name =>
        <option key={name} value={name}>{name || t('待定')}</option>)}
    </select>
    <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-1.5 h-3.5 w-3.5 opacity-70"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="8" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
    <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-1.5 h-3 w-3 opacity-60"
      fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </span>;
}
