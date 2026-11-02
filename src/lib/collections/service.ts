import { db, withDatabaseTransaction } from '@/lib/db';
import { CollectionError, MAX_RECORDS, parseDefinition, validateValues, type CollectionDefinition, type CollectionInfo, type RecordValues } from './schema';

const decode = (row: { id: string; definition: string; enabled: boolean; draft: boolean; version: number }): CollectionInfo => ({ ...row, definition: parseDefinition(JSON.parse(row.definition)) });
export async function listCollections(manage = false): Promise<CollectionInfo[]> {
  const rows = await db.customCollection.findMany({ where: manage ? {} : { enabled: true, draft: false }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return rows.map(decode);
}
export async function getCollection(id: string, manage = false): Promise<CollectionInfo> {
  const row = await db.customCollection.findUnique({ where: { id } });
  if (!row) throw new CollectionError('missing');
  if (!manage && (!row.enabled || row.draft)) throw new CollectionError('disabled');
  return decode(row);
}
async function checkTargets(definition: CollectionDefinition) {
  for (const field of definition.fields.filter(f => f.type === 'reference')) await getCollection(field.targetCollectionId!);
}
// Acquire SQLite's writer slot before checking policy/version. Also works inside
// the existing durable Agent transaction, through the platform's scoped client.
async function lockCollection(id: string) {
  await db.$executeRaw`UPDATE "CustomCollection" SET "version" = "version" WHERE "id" = ${id}`;
}
export async function createCollection(input: unknown, draft = false): Promise<CollectionInfo> {
  return withDatabaseTransaction(async () => {
    await db.$executeRaw`INSERT OR IGNORE INTO "Setting" ("key","value","updatedAt") VALUES ('collections.lock','1',0)`;
    await db.$executeRaw`UPDATE "Setting" SET "value" = "value" WHERE "key" = 'collections.lock'`;
    if (await db.customCollection.count() >= 100) throw new CollectionError('limit');
    const definition = parseDefinition(input); await checkTargets(definition);
    return decode(await db.customCollection.create({ data: { definition: JSON.stringify(definition), draft, enabled: !draft } }));
  });
}
export async function updateCollection(id: string, expectedVersion: number, input: unknown, enabled: boolean): Promise<CollectionInfo> {
  return withDatabaseTransaction(async () => {
    await lockCollection(id);
    const current = await getCollection(id, true);
    if (current.version !== expectedVersion) throw new CollectionError('conflict');
    const definition = parseDefinition(input);
    // Disabled reference targets may be retained while editing metadata, but no
    // new reference target is accepted without checking it is currently enabled.
    for (const f of definition.fields.filter(f => f.type === 'reference')) {
      const old = current.definition.fields.find(item => item.id === f.id);
      if (old?.targetCollectionId !== f.targetCollectionId) await getCollection(f.targetCollectionId!);
    }
    const records = await db.customRecord.findMany({ where: { collectionId: id } });
    for (const old of current.definition.fields) {
      const next = definition.fields.find(f => f.id === old.id);
      if (records.some(row => Object.hasOwn(JSON.parse(row.data), old.id)) && (!next || next.type !== old.type || next.targetCollectionId !== old.targetCollectionId)) throw new CollectionError('usedField');
    }
    // Validate every existing record, including archived records, before committing.
    for (const row of records) validateValues(definition, JSON.parse(row.data));
    await db.customCollectionVersion.create({ data: { collectionId: id, version: current.version, definition: JSON.stringify(current.definition) } });
    const saved = await db.customCollection.update({ where: { id }, data: { definition: JSON.stringify(definition), enabled, draft: false, version: { increment: 1 } } });
    // Title field/labels may change without rewriting user values.
    for (const row of records) {
      const values = validateValues(definition, JSON.parse(row.data));
      await db.customRecord.update({ where: { id: row.id }, data: { title: String(values[definition.titleFieldId]), searchText: Object.values(values).join('\n') } });
    }
    return decode(saved);
  });
}
export async function setCollectionEnabled(id: string, version: number, enabled: boolean) {
  return withDatabaseTransaction(async () => {
    await lockCollection(id);
    const current = await getCollection(id, true);
    if (current.version !== version || current.draft) throw new CollectionError('conflict');
    return decode(await db.customCollection.update({ where: { id }, data: { enabled, version: { increment: 1 } } }));
  });
}
async function checkReferences(definition: CollectionDefinition, values: RecordValues) {
  for (const field of definition.fields.filter(f => f.type === 'reference' && values[f.id])) {
    const target = await db.customRecord.findUnique({ where: { id: String(values[field.id]) }, include: { collection: true } });
    if (!target || target.collectionId !== field.targetCollectionId || target.archived || !target.collection.enabled || target.collection.draft) throw new CollectionError('reference');
  }
}
const recordDto = (row: { id: string; collectionId: string; title: string; data: string; archived: boolean; version: number; createdAt: Date; updatedAt: Date }) => ({ id: row.id, collectionId: row.collectionId, title: row.title, url: '/collections/' + row.collectionId + '/records/' + row.id, values: JSON.parse(row.data) as RecordValues, archived: row.archived, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
export type CollectionRecord = ReturnType<typeof recordDto>;
export async function readRecord(collectionId: string, id: string) {
  const collection = await getCollection(collectionId);
  const row = await db.customRecord.findFirst({ where: { id, collectionId } });
  if (!row) throw new CollectionError('missing');
  return { record: recordDto(row), schemaVersion: collection.version };
}
export type RecordFilter = { fieldId: string; op: 'eq' | 'gte' | 'lte'; value: string | number | boolean };
export async function queryRecords(collectionId: string, input: { query?: string; offset?: number; limit?: number; archived?: boolean; filters?: RecordFilter[] } = {}) {
  const collection = await getCollection(collectionId), offset = input.offset ?? 0, limit = input.limit ?? 25;
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_RECORDS || !Number.isInteger(limit) || limit < 1 || limit > 50 || (input.query?.length ?? 0) > 200 || (input.filters?.length ?? 0) > 5) throw new CollectionError('filter');
  for (const filter of input.filters || []) {
    const field = collection.definition.fields.find(f => f.id === filter.fieldId);
    if (!field || filter.op !== 'eq' && !['date', 'number'].includes(field.type)) throw new CollectionError('filter');
    validateValues({ ...collection.definition, fields: [{ ...field, required: true }] }, { [field.id]: filter.value });
  }
  // Pilot has a hard cap, not an unbounded scan. Return only the requested page.
  const rows = await db.customRecord.findMany({ where: { collectionId, archived: input.archived ?? false, ...(input.query ? { searchText: { contains: input.query.trim() } } : {}) }, take: MAX_RECORDS, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const records = rows.map(recordDto).filter(row => (input.filters || []).every(f => {
    const v = row.values[f.fieldId]; if (v === undefined || v === null) return false;
    return f.op === 'eq' ? v === f.value : f.op === 'gte' ? v >= f.value : v <= f.value;
  }));
  return { records: records.slice(offset, offset + limit), total: records.length, nextOffset: offset + limit < records.length ? offset + limit : null, schemaVersion: collection.version };
}
export async function writeRecord(collectionId: string, schemaVersion: number, values: unknown, id?: string, expectedVersion?: number) {
  return withDatabaseTransaction(async () => {
    await lockCollection(collectionId);
    const collection = await getCollection(collectionId);
    if (collection.version !== schemaVersion) throw new CollectionError('conflict');
    let current = id ? await db.customRecord.findFirst({ where: { id, collectionId } }) : null;
    if (id && !current) throw new CollectionError('missing');
    if (current && (current.version !== expectedVersion || current.archived)) throw new CollectionError('conflict');
    const patch = values && typeof values === 'object' && !Array.isArray(values) ? values : null;
    if (!patch) throw new CollectionError('values');
    const clean = validateValues(collection.definition, { ...(current ? JSON.parse(current.data) : {}), ...patch });
    await checkReferences(collection.definition, clean);
    const data = { data: JSON.stringify(clean), title: String(clean[collection.definition.titleFieldId]), searchText: Object.values(clean).join('\n') };
    if (!current && await db.customRecord.count({ where: { collectionId } }) >= MAX_RECORDS) throw new CollectionError('limit');
    const row = current ? await db.customRecord.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } }) : await db.customRecord.create({ data: { ...data, collectionId } });
    return { record: recordDto(row), schemaVersion: collection.version };
  });
}
export async function archiveRecord(collectionId: string, id: string, expectedVersion: number, archived: boolean) {
  return withDatabaseTransaction(async () => {
    await lockCollection(collectionId); await getCollection(collectionId);
    const current = await db.customRecord.findFirst({ where: { id, collectionId } });
    if (!current) throw new CollectionError('missing');
    if (current.version !== expectedVersion) throw new CollectionError('conflict');
    return recordDto(await db.customRecord.update({ where: { id }, data: { archived, version: { increment: 1 } } }));
  });
}
