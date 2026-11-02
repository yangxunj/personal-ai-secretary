import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { getT } from '@/lib/i18n/server';
import { getCollection, queryRecords, readRecord } from '@/lib/collections/service';
import type { CollectionField } from '@/lib/collections/schema';

export const dynamic = 'force-dynamic';
export default async function CollectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; offset?: string; archived?: string; view?: string; error?: string }> }) {
  const { id } = await params, query = await searchParams, t = await getT();
  const collection = await getCollection(id, true).catch(() => null); if (!collection) notFound();
  const header = <PageHeader title={collection.definition.title} back="/collections" />;
  if (!collection.enabled || collection.draft) return <>{header}<div className="p-4 space-y-4"><p>{t('栏目尚未启用，请先在栏目目录中启用。')}</p><Link href="/collections" className="text-brand-500">{t('返回栏目目录')}</Link></div></>;
  const offset = Math.min(2000, Math.max(0, Number.parseInt(query.offset || '0', 10) || 0)), archived = query.archived === '1', text = (query.q || '').slice(0, 200);
  const result = await queryRecords(id, { query: text, offset, limit: 25, archived });
  const view = query.view === 'cards' || query.view === 'table' ? query.view : collection.definition.view;
  const referenceLabels: Record<string, string> = {};
  for (const field of collection.definition.fields.filter(f => f.type === 'reference')) for (const value of new Set(result.records.map(r => r.values[field.id]).filter(Boolean))) {
    const item = await readRecord(field.targetCollectionId!, String(value)).catch(() => null);
    if (item) referenceLabels[field.id + ':' + value] = item.record.title + (item.record.archived ? ' · ' + t('已归档') : '');
  }
  const display = (field: CollectionField, value: unknown) => value === null || value === undefined ? '—' : field.type === 'boolean' ? value ? t('是') : t('否') : field.type === 'reference' ? referenceLabels[field.id + ':' + value] || t('关联不可用') : String(value);
  const href = (patch: Record<string, string>) => '/collections/' + id + '?' + new URLSearchParams({ q: text, archived: archived ? '1' : '0', view, ...patch });
  return <>{header}<div className="p-4 space-y-4">
    {collection.definition.description && <p className="muted text-sm break-words">{collection.definition.description}</p>}
    <div className="flex flex-wrap gap-3 text-sm"><Link href={'/collections/' + id + '/new'} className="rounded-xl bg-brand-500 px-4 py-2 text-white">{t('新增记录')}</Link><Link href={'/collections/' + id + '/configure'} className="rounded-xl border px-4 py-2" style={{ borderColor: 'var(--border)' }}>{t('配置栏目')}</Link></div>
    {query.error && <p role="alert" className="text-sm text-red-500">{query.error}</p>}
    <form className="flex gap-2" method="get"><input type="hidden" name="view" value={view} /><input type="hidden" name="archived" value={archived ? '1' : '0'} /><input name="q" aria-label={t('搜索栏目记录')} placeholder={t('搜索栏目记录')} maxLength={200} defaultValue={text} className="min-w-0 flex-1 rounded-xl border p-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }} /><button className="rounded-xl border px-4" style={{ borderColor: 'var(--border)' }}>{t('搜索')}</button></form>
    <div className="flex flex-wrap items-center gap-3 text-xs"><span className="muted">{t('共 {n} 条记录', { n: result.total })}</span><Link href={href({ offset: '0', archived: archived ? '0' : '1' })} className="text-brand-500 dark:text-brand-300">{archived ? t('查看使用中') : t('查看已归档')}</Link><Link href={href({ offset: '0', view: view === 'table' ? 'cards' : 'table' })} className="text-brand-500 dark:text-brand-300">{view === 'table' ? t('切换为卡片') : t('切换为表格')}</Link></div>
    {!result.records.length && <p className="muted text-sm py-8 text-center">{t('没有符合条件的记录。')}</p>}
    {view === 'table' && !!result.records.length && <div className="overflow-x-auto rounded-xl border surface" style={{ borderColor: 'var(--border)' }}><table className="w-full text-sm"><thead><tr>{collection.definition.fields.map(field => <th key={field.id} className="text-left whitespace-nowrap p-3 border-b" style={{ borderColor: 'var(--border)' }}>{field.label}</th>)}</tr></thead><tbody>{result.records.map(row => <tr key={row.id}>{collection.definition.fields.map(field => <td key={field.id} className="p-3 border-b align-top max-w-xs" style={{ borderColor: 'var(--border)' }}>{field.id === collection.definition.titleFieldId ? <Link className="text-brand-500 dark:text-brand-300 break-words" href={'/collections/' + id + '/records/' + row.id}>{row.title}</Link> : <span className="block line-clamp-3 break-words">{display(field, row.values[field.id])}</span>}</td>)}</tr>)}</tbody></table></div>}
    {view === 'cards' && <div className="grid gap-3 sm:grid-cols-2">{result.records.map(row => <Link key={row.id} href={'/collections/' + id + '/records/' + row.id} className="min-w-0 rounded-xl border surface p-4" style={{ borderColor: 'var(--border)' }}><h2 className="font-medium break-words">{row.title}</h2><dl className="space-y-2 mt-3">{collection.definition.fields.filter(f => f.id !== collection.definition.titleFieldId).map(field => <div key={field.id} className="text-xs"><dt className="muted">{field.label}</dt><dd className="line-clamp-3 break-words mt-1">{display(field, row.values[field.id])}</dd></div>)}</dl></Link>)}</div>}
    <div className="flex justify-between text-sm">{offset > 0 ? <Link href={href({ offset: String(Math.max(0, offset - 25)) })}>{t('上一页')}</Link> : <span />}{result.nextOffset !== null && <Link href={href({ offset: String(result.nextOffset) })}>{t('下一页')}</Link>}</div>
  </div></>;
}
