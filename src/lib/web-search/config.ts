import { db } from '@/lib/db';
import { getAiConfig } from '@/lib/ai-config';
import { selectSearchKey } from './client.mjs';

export async function getWebSearchConfig() {
  const rows=await db.setting.findMany({where:{key:{in:['webSearch.enabled','webSearch.apiKey']}}});
  const settings=new Map(rows.map(r=>[r.key,r.value]));
  const cfg=await getAiConfig();
  const dedicatedKey=settings.get('webSearch.apiKey')||process.env.DEEPSEEK_SEARCH_API_KEY||process.env.DEEPSEEK_API_KEY||'';
  return {enabled:settings.get('webSearch.enabled')==='true',apiKey:selectSearchKey({...cfg,dedicatedKey})};
}
