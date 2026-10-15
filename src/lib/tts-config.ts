import { db } from '@/lib/db';
import { getTtsConfig } from '@/lib/tts';

export async function loadTtsConfig() {
  const rows = await db.setting.findMany({ where: { key: { in: ['tts.apiKey', 'tts.baseUrl', 'tts.model', 'tts.voice'] } } });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const defaults = getTtsConfig();
  return {
    apiKey: values.get('tts.apiKey')?.trim() || defaults.apiKey,
    baseUrl: values.get('tts.baseUrl')?.trim() || defaults.baseUrl,
    model: values.get('tts.model')?.trim() || defaults.model,
    voice: values.get('tts.voice')?.trim() || defaults.voice,
  };
}
