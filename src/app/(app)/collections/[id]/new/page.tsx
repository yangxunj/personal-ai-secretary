import { notFound } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { getT } from '@/lib/i18n/server';
import { getCollection } from '@/lib/collections/service';
import RecordForm from '../../RecordForm';
import { recordOptions } from '../../record-options';
export const dynamic = 'force-dynamic';
export default async function NewRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params, t = await getT();
  const collection = await getCollection(id).catch(() => null); if (!collection) notFound();
  return <><PageHeader title={t('新增记录')} back={'/collections/' + id} /><div className="p-4 space-y-3"><p className="muted text-sm">{collection.definition.title}</p><RecordForm collection={collection} references={await recordOptions(collection)} /></div></>;
}
