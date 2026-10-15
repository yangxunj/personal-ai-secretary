import { db } from '@/lib/db';
import { getAsrConfig } from '@/lib/asr';

/** 设置页优先，环境变量兜底；不复用聊天配置，也不自动向安装包写入密钥。 */
export async function loadAsrConfig() {
  const rows = await db.setting.findMany({ where: { key: { in: ['asr.apiKey', 'asr.baseUrl', 'asr.model'] } } });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const defaults = getAsrConfig();
  return {
    apiKey: values.get('asr.apiKey')?.trim() || defaults.apiKey,
    baseUrl: values.get('asr.baseUrl')?.trim() || defaults.baseUrl,
    model: values.get('asr.model')?.trim() || defaults.model,
  };
}
