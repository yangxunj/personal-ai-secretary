import { db } from '@/lib/db';
export const codexToolProfileKey=(conversationId:string)=>'codex.tools.'+conversationId;
// Installed protocol cannot refresh dynamicTools on resume. Only threads created
// with this complete platform profile may be told the new tools are available.
export async function getCodexToolVersion(conversationId:string,threadId:string|null):Promise<0|1|2|3> {
  if(!threadId)return 3;
  const setting=await db.setting.findUnique({where:{key:codexToolProfileKey(conversationId)}});
  try{const profile=JSON.parse(setting?.value||'null');return profile?.threadId===threadId&&[1,2,3].includes(profile?.version)?profile.version:0;}catch{return 0;}
}
export async function hasCodexFileTools(conversationId:string,threadId:string|null){return (await getCodexToolVersion(conversationId,threadId))>=1;}
