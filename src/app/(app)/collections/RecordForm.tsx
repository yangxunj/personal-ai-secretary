'use client';

import { startTransition, useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import type { CollectionInfo, RecordValues } from '@/lib/collections/schema';
import type { CollectionRecord } from '@/lib/collections/service';
import { saveCollectionRecordAction, searchCollectionReferencesAction, type CollectionSaveResult } from './actions';

type ReferenceOption = { id: string; title: string };
function ReferencePicker({ target, value, onChange, initial, required, inputId, label }: { target: string; value: string; onChange: (value: string) => void; initial: ReferenceOption[]; required: boolean; inputId: string; label: string }) {
  const t = useT(), [query, setQuery] = useState(''), [options, setOptions] = useState(initial), [error, setError] = useState(false);
  const [known, setKnown] = useState(() => Object.fromEntries(initial.map(item => [item.id, item.title])));
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => { searchCollectionReferencesAction(target, query).then(items => { if (!cancelled) { setOptions(items); setKnown(previous => ({ ...previous, ...Object.fromEntries(items.map(item => [item.id, item.title])) })); setError(false); } }).catch(() => { if (!cancelled) setError(true); }); }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [target, query]);
  return <div className="space-y-1 mt-1">
    <input aria-label={t('搜索关联记录：{field}', { field: label })} value={query} maxLength={200} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} placeholder={t('输入关键词查找关联记录')} className="w-full rounded-xl border bg-transparent p-2.5" style={{ borderColor: 'var(--border)' }} />
    <select id={inputId} required={required} value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border bg-transparent p-2.5" style={{ borderColor: 'var(--border)' }}>
      <option value="">{t('未填写')}</option>
      {value && !options.some(o => o.id === value) && <option value={value}>{known[value] || t('原关联记录')}</option>}
      {options.map(option => <option key={option.id} value={option.id}>{option.title}</option>)}
    </select>
    {error && <p className="text-xs text-red-500">{t('无法读取关联记录，请检查目标栏目是否启用。')}</p>}
  </div>;
}
export default function RecordForm({ collection, record, references }: { collection: CollectionInfo; record?: CollectionRecord; references: Record<string, ReferenceOption[]> }) {
  const t = useT(), router = useRouter();
  const [values, setValues] = useState<RecordValues>(() => ({ ...Object.fromEntries(collection.definition.fields.filter(f => f.type === 'boolean').map(f => [f.id, false])), ...record?.values }));
  const [initialVersion] = useState(record?.version), [schemaVersion] = useState(collection.version);
  const [dirty, setDirty] = useState(false);
  const [result, save, pending] = useActionState<CollectionSaveResult, FormData>(saveCollectionRecordAction, { ok: false, message: '' });
  useEffect(() => { if (result.ok && result.url) router.push(result.url); }, [result, router]);
  const change = (id: string, value: RecordValues[string]) => { setValues(current => ({ ...current, [id]: value })); setDirty(true); };
  const inputClass = 'mt-1 w-full rounded-xl border bg-transparent p-2.5';
  const border = { borderColor: 'var(--border)' };
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget), submitted = { ...values };
    for (const field of collection.definition.fields.filter(f => f.type === 'number')) {
      const value = submitted[field.id]; if (typeof value === 'string') submitted[field.id] = value.trim() === '' ? null : Number(value);
    }
    form.set('values', JSON.stringify(submitted)); setDirty(false); startTransition(() => save(form));
  }}>
    <input type="hidden" name="collectionId" value={collection.id} />
    <input type="hidden" name="recordId" value={record?.id || ''} />
    <input type="hidden" name="version" value={result.version || initialVersion || ''} />
    <input type="hidden" name="schemaVersion" value={result.schemaVersion || schemaVersion} />
    <fieldset disabled={pending || record?.archived} className="min-w-0 space-y-4">
      {collection.definition.fields.map(field => <div key={field.id}>
        <label htmlFor={'value-' + field.id} className="block text-sm">{field.label}{field.required && <span className="ml-1 text-red-500">*</span>}</label>
        {field.type === 'reference'
          ? <ReferencePicker target={field.targetCollectionId!} inputId={'value-' + field.id} label={field.label} value={String(values[field.id] || '')} onChange={v => change(field.id, v || null)} initial={references[field.id] || []} required={field.required} />
          : field.type === 'longText'
          ? <textarea id={'value-' + field.id} required={field.required} maxLength={20000} rows={5} value={String(values[field.id] ?? '')} onChange={e => change(field.id, e.target.value)} className={inputClass} style={border} />
          : field.type === 'select'
          ? <select id={'value-' + field.id} required={field.required} value={String(values[field.id] ?? '')} onChange={e => change(field.id, e.target.value || null)} className={inputClass} style={border}><option value="">{t('未填写')}</option>{field.options!.map(value => <option key={value} value={value}>{value}</option>)}</select>
          : field.type === 'boolean'
          ? <input id={'value-' + field.id} type="checkbox" checked={values[field.id] === true} onChange={e => change(field.id, e.target.checked)} className="mt-2 h-5 w-5" />
          : <input id={'value-' + field.id} type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} step={field.type === 'number' ? 'any' : undefined} maxLength={200} required={field.required} value={String(values[field.id] ?? '')} onChange={e => change(field.id, e.target.value)} className={inputClass} style={border} />}
      </div>)}
    </fieldset>
    {result.message && !dirty && <p role={result.ok ? 'status' : 'alert'} className={`text-sm ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{result.message}</p>}
    {record?.archived ? <p className="muted text-sm">{t('此记录已归档，恢复后可以编辑。')}</p> : <button disabled={pending} aria-busy={pending} className="w-full rounded-xl bg-brand-500 p-3 text-white disabled:opacity-50">{pending ? t('正在保存…') : t('保存记录')}</button>}
  </form>;
}
