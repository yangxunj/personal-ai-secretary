'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { sessionIsCurrent } from '@/lib/auth';
import { getT } from '@/lib/i18n/server';
import { withDatabaseTransaction } from '@/lib/db';
import { collectionError, CollectionError } from '@/lib/collections/schema';
import { collectionTemplates } from '@/lib/collections/templates';
import { createCollection, updateCollection, setCollectionEnabled, writeRecord, archiveRecord, queryRecords } from '@/lib/collections/service';

export type CollectionSaveResult = { ok: boolean; message: string; url?: string; version?: number; schemaVersion?: number };
async function authorize() { if (!(await sessionIsCurrent())) redirect('/login'); }
function json(form: FormData, key: string) {
  const raw = form.get(key); if (typeof raw !== 'string' || raw.length > 50000) throw new CollectionError('values');
  try { return JSON.parse(raw); } catch { throw new CollectionError('values'); }
}
function version(form: FormData, key: string) {
  const value = Number(form.get(key)); if (!Number.isSafeInteger(value) || value < 1) throw new CollectionError('conflict'); return value;
}
function refresh() { revalidatePath('/collections', 'layout'); revalidatePath('/', 'layout'); }
export async function saveCollectionAction(_previous: CollectionSaveResult, form: FormData): Promise<CollectionSaveResult> {
  await authorize(); const t = await getT();
  try {
    const id = String(form.get('collectionId') || ''), definition = json(form, 'definition');
    const collection = id ? await updateCollection(id, version(form, 'version'), definition, form.get('enabled') === 'on') : await createCollection(definition);
    refresh(); return { ok: true, message: t('已保存'), url: collection.enabled ? '/collections/' + collection.id : '/collections' };
  } catch (error) { return { ok: false, message: collectionError(error, t) }; }
}
export async function saveCollectionRecordAction(_previous: CollectionSaveResult, form: FormData): Promise<CollectionSaveResult> {
  await authorize(); const t = await getT();
  try {
    const collectionId = String(form.get('collectionId') || ''), id = String(form.get('recordId') || '');
    const result = await writeRecord(collectionId, version(form, 'schemaVersion'), json(form, 'values'), id || undefined, id ? version(form, 'version') : undefined);
    refresh(); return { ok: true, message: t('已保存'), version: result.record.version, schemaVersion: result.schemaVersion, ...(!id ? { url: '/collections/' + collectionId } : {}) };
  } catch (error) { return { ok: false, message: collectionError(error, t) }; }
}
export async function toggleCollectionAction(form: FormData) {
  await authorize(); const t = await getT(); let error = '';
  try { await setCollectionEnabled(String(form.get('collectionId')), version(form, 'version'), form.get('enabled') === 'true'); refresh(); }
  catch (e) { error = collectionError(e, t); }
  redirect('/collections' + (error ? '?error=' + encodeURIComponent(error) : ''));
}
export async function archiveCollectionRecordAction(form: FormData) {
  await authorize(); const t = await getT(); let error = '';
  const collectionId = String(form.get('collectionId') || '');
  try { await archiveRecord(collectionId, String(form.get('recordId')), version(form, 'version'), form.get('archived') === 'true'); refresh(); }
  catch (e) { error = collectionError(e, t); }
  redirect('/collections/' + encodeURIComponent(collectionId) + (error ? '?error=' + encodeURIComponent(error) : ''));
}
export async function installCollectionTemplateAction(form: FormData) {
  await authorize(); const t = await getT(); let url = '/collections';
  try {
    const template = collectionTemplates(t).find(item => item.id === form.get('template'));
    if (!template) throw new CollectionError('definition');
    const parent = await withDatabaseTransaction(async () => {
      const parent = await createCollection(template.parent);
      await createCollection({ ...template.child, fields: template.child.fields.map(f => f.type === 'reference' ? { ...f, targetCollectionId: parent.id } : f) });
      return parent;
    });
    refresh(); url += '/' + parent.id;
  } catch (e) { url += '?error=' + encodeURIComponent(collectionError(e, t)); }
  redirect(url);
}
export async function searchCollectionReferencesAction(collectionId: string, query: string) {
  await authorize();
  const result = await queryRecords(collectionId, { query, limit: 20 });
  return result.records.map(row => ({ id: row.id, title: row.title }));
}
