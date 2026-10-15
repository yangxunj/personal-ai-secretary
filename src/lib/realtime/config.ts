import { db } from '@/lib/db';

export const REALTIME_MODELS = ['qwen-audio-3.0-realtime-plus', 'qwen-audio-3.0-realtime-flash'] as const;
export function realtimeDefaults(env = process.env) {
  return {
    apiKey: (env.REALTIME_API_KEY || env.DASHSCOPE_API_KEY || '').trim(),
    endpoint: (env.REALTIME_BASE_URL || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime').trim(),
    model: (env.REALTIME_MODEL || REALTIME_MODELS[0]).trim(),
    voice: (env.REALTIME_VOICE || 'longanqian').trim(),
  };
}
export function validRealtimeConfig(config: ReturnType<typeof realtimeDefaults>) {
  try {
    const url = new URL(config.endpoint);
    return url.protocol === 'wss:' && !url.username && !url.password && !url.hash && !url.search
      && REALTIME_MODELS.some(model => model === config.model) && /^[a-zA-Z0-9_-]{1,80}$/.test(config.voice);
  } catch { return false; }
}
export async function loadRealtimeConfig() {
  const rows = await db.setting.findMany({ where: { key: { startsWith: 'realtime.' } } });
  const values = new Map(rows.map(row => [row.key, row.value]));
  const defaults = realtimeDefaults();
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, values.get(`realtime.${key}`)?.trim() || value])) as typeof defaults;
}
