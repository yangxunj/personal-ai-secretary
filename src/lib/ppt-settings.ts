import { db } from '@/lib/db';

const OPENROUTER_KEY = 'ppt.openrouterApiKey';

/** Secret is server-only. An empty form field keeps the existing value. */
export async function getPptOpenRouterKey(): Promise<string> {
  return (await db.setting.findUnique({ where: { key: OPENROUTER_KEY } }))?.value.trim() || '';
}

export async function savePptOpenRouterKey(input: string): Promise<boolean> {
  const key = input.replace(/\s+/g, '');
  if (!key) return Boolean(await getPptOpenRouterKey());
  if (key.length < 8 || key.length > 4096) return false;
  await db.setting.upsert({ where: { key: OPENROUTER_KEY }, create: { key: OPENROUTER_KEY, value: key }, update: { value: key } });
  return true;
}
