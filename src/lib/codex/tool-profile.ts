import { db } from '@/lib/db';
export const codexToolProfileKey=(conversationId:string)=>'codex.tools.'+conversationId;
// Installed protocol cannot refresh dynamicTools on resume. Only threads created
// with this complete platform profile may be told the new tools are available.
export async function hasCodexFileTools(conversationId:string,threadId:string|null) {
  if(!threadId)return true;
  const setting=await db.setting.findUnique({where:{key:codexToolProfileKey(conversationId)}});
  try{const profile=JSON.parse(setting?.value||'null');return profile?.threadId===threadId&&profile?.version===1;}catch{return false;}
}
