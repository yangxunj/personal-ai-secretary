import { CollectionError, validateValues, type CollectionDefinition, type RecordValues } from './schema';

export type CurrentRecord = { values: RecordValues; version: number; archived: boolean };

/** Shared write policy. Call inside the adapter's transaction and repeat version
 * matching atomically when persisting. Reference lookups remain adapter work. */
export function prepareRecordWrite(definition: CollectionDefinition, input: unknown, current?: CurrentRecord, expectedVersion?: number) {
  if (current && (current.version !== expectedVersion || current.archived)) throw new CollectionError('conflict');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CollectionError('values');
  const values = validateValues(definition, { ...(current?.values ?? {}), ...input });
  return {
    values,
    data: JSON.stringify(values),
    title: String(values[definition.titleFieldId]),
    searchText: Object.values(values).join('\n'),
  };
}
