import type { CollectionInfo } from '@/lib/collections/schema';
import { queryRecords, readRecord, type CollectionRecord } from '@/lib/collections/service';

export async function recordOptions(collection: CollectionInfo, record?: CollectionRecord) {
  const references: Record<string, { id: string; title: string }[]> = {};
  for (const field of collection.definition.fields.filter(f => f.type === 'reference')) {
    const page = await queryRecords(field.targetCollectionId!, { limit: 20 }).catch(() => null);
    references[field.id] = page?.records.map(r => ({ id: r.id, title: r.title })) || [];
    const selected = record?.values[field.id];
    if (selected && !references[field.id].some(r => r.id === selected)) {
      const item = await readRecord(field.targetCollectionId!, String(selected)).catch(() => null);
      if (item) references[field.id].push({ id: item.record.id, title: item.record.title });
    }
  }
  return references;
}
