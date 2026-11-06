'use client';

const OPTIONS = ['todo', 'doing', 'done'];
export default function TaskStatusSelect({ status, disabled, onChange, t }: {
  status: string; disabled?: boolean; onChange: (value: string) => void; t: (text: string) => string;
}) {
  const label = (value: string) => value === 'todo' ? t('未开始') : value === 'doing' ? t('进行中') :
    value === 'done' ? t('已完成') : value === 'cancelled' ? t('已取消') : value;
  const options = OPTIONS.includes(status) ? OPTIONS : [status, ...OPTIONS];
  return <span className="relative z-[2] inline-flex items-center">
    <select value={status} disabled={disabled} onChange={event => onChange(event.target.value)} aria-label={t('状态')}
      className={`chip-select rounded-lg border px-2.5 pr-6 py-1.5 active:opacity-60 disabled:opacity-50 ${
        status === 'doing' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium' :
          status === 'done' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium' : 'muted'}`}
      style={{ borderColor: 'var(--border)' }}>
      {options.map(value => <option key={value} value={value}>{label(value)}</option>)}
    </select>
    <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-1.5 h-3 w-3 opacity-60"
      fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </span>;
}
