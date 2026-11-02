'use client';

import { startTransition, useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { fieldTypes, type CollectionDefinition, type CollectionField, type CollectionInfo } from '@/lib/collections/schema';
import { saveCollectionAction, type CollectionSaveResult } from './actions';

export function fieldTypeLabel(type: string, t: ReturnType<typeof useT>) {
  switch (type) {
    case 'text': return t('短文本'); case 'longText': return t('长文本'); case 'number': return t('数字');
    case 'date': return t('日期'); case 'select': return t('单选选项'); case 'boolean': return t('勾选'); case 'reference': return t('关联记录'); default: return type;
  }
}
export default function CollectionDesigner({ collection, targets }: { collection?: CollectionInfo; targets: CollectionInfo[] }) {
  const t = useT(), router = useRouter();
  const [definition, setDefinition] = useState<CollectionDefinition>(() => collection?.definition || { title: '', description: '', view: 'table', titleFieldId: 'name', fields: [{ id: 'name', label: t('名称'), type: 'text', required: true }] });
  const [enabled, setEnabled] = useState(collection?.draft ? true : collection?.enabled ?? true);
  const [expectedVersion] = useState(collection?.version);
  const [result, save, pending] = useActionState<CollectionSaveResult, FormData>(saveCollectionAction, { ok: false, message: '' });
  useEffect(() => { if (result.ok && result.url) router.push(result.url); }, [result, router]);
  const patchField = (id: string, patch: Partial<CollectionField>) => setDefinition(d => ({ ...d, fields: d.fields.map(f => f.id === id ? { ...f, ...patch } : f) }));
  const inputClass = 'w-full rounded-xl border p-2.5 bg-transparent outline-none focus:border-brand-500';
  const border = { borderColor: 'var(--border)' };
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    form.set('definition', JSON.stringify({ ...definition, fields: definition.fields.map(field => field.type === 'select' ? { ...field, options: field.options?.map(option => option.trim()).filter(Boolean) } : field) })); startTransition(() => save(form));
  }}>
    <input type="hidden" name="collectionId" value={collection?.id || ''} />
    <input type="hidden" name="version" value={expectedVersion || ''} />
    <fieldset disabled={pending} className="min-w-0 space-y-4">
      <label className="block text-sm">{t('栏目名称')}<input required maxLength={80} value={definition.title} onChange={e => setDefinition({ ...definition, title: e.target.value })} className={inputClass + ' mt-1'} style={border} /></label>
      <label className="block text-sm">{t('栏目说明')}<textarea maxLength={500} value={definition.description} onChange={e => setDefinition({ ...definition, description: e.target.value })} className={inputClass + ' mt-1'} style={border} /></label>
      <label className="block text-sm">{t('默认视图')}<select value={definition.view} onChange={e => setDefinition({ ...definition, view: e.target.value as 'table' | 'cards' })} className={inputClass + ' mt-1'} style={border}><option value="table">{t('表格')}</option><option value="cards">{t('卡片')}</option></select></label>
      <div className="space-y-3">
        <h2 className="font-semibold">{t('字段配置')}</h2>
        {definition.fields.map((field, index) => <div key={field.id} className="surface rounded-xl border p-3 space-y-2" style={border}>
          <div className="flex items-center justify-between gap-2"><span className="muted text-xs">{t('字段 {n}', { n: index + 1 })}</span><button type="button" disabled={definition.titleFieldId === field.id} className="text-xs text-red-500 disabled:opacity-30" onClick={() => setDefinition({ ...definition, fields: definition.fields.filter(f => f.id !== field.id) })}>{t('移除')}</button></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">{t('字段名称')}<input required maxLength={60} value={field.label} onChange={e => patchField(field.id, { label: e.target.value })} className={inputClass + ' mt-1'} style={border} /></label>
            <label className="text-xs">{t('字段类型')}<select value={field.type} disabled={definition.titleFieldId === field.id} onChange={e => patchField(field.id, { type: e.target.value as CollectionField['type'], options: e.target.value === 'select' ? [] : undefined, targetCollectionId: e.target.value === 'reference' ? targets[0]?.id : undefined })} className={inputClass + ' mt-1'} style={border}>{fieldTypes.map(type => <option key={type} value={type}>{fieldTypeLabel(type, t)}</option>)}</select></label>
          </div>
          {field.type === 'select' && <label className="block text-xs">{t('可选值（每行一个）')}<textarea required value={(field.options || []).join('\n')} onChange={e => patchField(field.id, { options: e.target.value.split('\n') })} className={inputClass + ' mt-1'} style={border} /></label>}
          {field.type === 'reference' && <label className="block text-xs">{t('关联栏目')}<select required value={field.targetCollectionId || ''} onChange={e => patchField(field.id, { targetCollectionId: e.target.value })} className={inputClass + ' mt-1'} style={border}><option value="">{t('请选择')}</option>{targets.map(item => <option key={item.id} value={item.id}>{item.definition.title}{item.enabled ? '' : ' · ' + t('未启用')}</option>)}</select></label>}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={field.required} disabled={definition.titleFieldId === field.id} onChange={e => patchField(field.id, { required: e.target.checked })} />{t('必填')}</label>
        </div>)}
        <button type="button" disabled={definition.fields.length >= 20} className="w-full rounded-xl border border-dashed p-3 text-sm text-brand-500 disabled:opacity-40" style={border} onClick={() => setDefinition({ ...definition, fields: [...definition.fields, { id: 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10), label: '', type: 'text', required: false }] })}>{t('添加字段')}</button>
      </div>
      <label className="block text-sm">{t('记录标题使用哪个字段')}<select value={definition.titleFieldId} onChange={e => setDefinition({ ...definition, titleFieldId: e.target.value, fields: definition.fields.map(f => f.id === e.target.value ? { ...f, required: true } : f) })} className={inputClass + ' mt-1'} style={border}>{definition.fields.filter(f => f.type === 'text').map(f => <option key={f.id} value={f.id}>{f.label || t('未命名字段')}</option>)}</select></label>
      {collection && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} />{t('启用栏目并显示在导航中')}</label>}
    </fieldset>
    <p className="muted text-xs leading-relaxed">{t('字段最多 20 个。改显示名称保留原数据；使用中的字段暂不能删除或改变类型。日期字段不会自动生成提醒。')}</p>
    {result.message && <p role={result.ok ? 'status' : 'alert'} className="text-sm text-red-500">{result.message}</p>}
    <button disabled={pending} aria-busy={pending} className="w-full rounded-xl bg-brand-500 p-3 text-white disabled:opacity-50">{pending ? t('正在保存…') : collection?.draft ? t('确认创建栏目') : t('保存栏目')}</button>
  </form>;
}
