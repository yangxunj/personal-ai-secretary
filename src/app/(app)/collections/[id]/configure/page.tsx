import { notFound } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { getT } from '@/lib/i18n/server';
import { getCollection, listCollections } from '@/lib/collections/service';
import CollectionDesigner from '../../CollectionDesigner';
export const dynamic = 'force-dynamic';
export default async function ConfigureCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, t = await getT();
  const collection = await getCollection(id, true).catch(() => null); if (!collection) notFound();
  const targets = (await listCollections(true)).filter(c => !c.draft);
  return <><PageHeader title={t('配置栏目')} back="/collections" /><div className="p-4 space-y-4">
    {collection.draft && <p role="status" className="surface rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--border)' }}>{t('这是 AI 提议的草案，尚未启用。请检查名称、字段和关联目标，确认后再创建。')}</p>}
    <CollectionDesigner collection={collection} targets={targets} />
  </div></>;
}
