import { notFound } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { getT } from '@/lib/i18n/server';
import { getCollection, readRecord } from '@/lib/collections/service';
import RecordForm from '../../../RecordForm';
import { recordOptions } from '../../../record-options';
import { archiveCollectionRecordAction } from '../../../actions';
export const dynamic = 'force-dynamic';
export default async function RecordPage({ params }: { params: Promise<{ id: string; recordId: string }> }) {
  const { id, recordId } = await params, t = await getT();
  const collection = await getCollection(id).catch(() => null), found = collection ? await readRecord(id, recordId).catch(() => null) : null;
  if (!collection || !found) notFound();
  const record = found.record;
  return <><PageHeader title={record.title} back={'/collections/' + id} /><div className="p-4 space-y-5"><RecordForm collection={collection} record={record} references={await recordOptions(collection, record)} />
    <form action={archiveCollectionRecordAction}><input type="hidden" name="collectionId" value={id} /><input type="hidden" name="recordId" value={record.id} /><input type="hidden" name="version" value={record.version} /><input type="hidden" name="archived" value={String(!record.archived)} /><button className="w-full rounded-xl border p-3 text-sm muted" style={{ borderColor: 'var(--border)' }}>{record.archived ? t('恢复记录') : t('归档记录')}</button></form>
  </div></>;
}
