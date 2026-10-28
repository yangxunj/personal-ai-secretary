import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/lib/db';
import { UPLOAD_DIR } from '@/lib/storage';
import { CodexConnection } from './protocol.mjs';
import { codexSearchConfig } from './web-search.mjs';

export const localCodexEnabled = () => process.env.DESKTOP_APP === '1' || process.env.ENABLE_LOCAL_CODEX === 'true';
export async function getChatBackend() {
  const selected=(await db.setting.findUnique({where:{key:'ai.backend'}}))?.value;
  // Only choose a harness for new chats. Existing conversations retain their
  // stored backend, including legacy API chats; do not rewrite their history.
  return selected==='codex'&&localCodexEnabled()?'codex':'pi';
}
export async function getCodexConfig() {
  const rows=await db.setting.findMany({where:{key:{in:['codex.path','codex.model','codex.effort','codex.webSearch']}}});
  const m=new Map(rows.map(r=>[r.key,r.value]));
  return {executable:m.get('codex.path') || process.env.SECRETARY_CODEX_PATH || '',model:m.get('codex.model') || '',effort:m.get('codex.effort') || 'medium',webSearchEnabled:m.get('codex.webSearch')==='true'};
}
export async function openCodex({forChat=false}={}) {
  if (!localCodexEnabled()) throw new Error('Local Codex is disabled on this deployment.');
  const cfg=await getCodexConfig();
  const cwd=path.resolve(UPLOAD_DIR,'../codex-workspace');await mkdir(cwd,{recursive:true});
  const webSearch=forChat&&cfg.webSearchEnabled?'live':'disabled';
  const client=new CodexConnection({executable:cfg.executable,cwd,webSearch});
  try {
    await client.connect();
    const account=await client.request('account/read',{refreshToken:true});
    if(!account.account)throw new Error('Codex is not signed in. Sign in to Codex on this computer first.');
    // Disable inherited MCP servers for this app, without editing the user's Codex config.
    const {config:inherited}=await client.request('config/read',{includeLayers:false});
    const config:Record<string,unknown>=codexSearchConfig(webSearch);
    for(const name of Object.keys(inherited?.mcp_servers || {}))config['mcp_servers.'+name+'.enabled']=false;
    return {client,cfg,cwd,config,webSearch,account:account.account};
  } catch(e) {client.close();throw e;}
}
export async function diagnoseCodex() {
  const {client,cfg,account}=await openCodex();
  try {
    const models=await client.request('model/list',{});
    return {authMode:account.type,plan:account.planType || null,model:cfg.model || models.data?.find((m:any)=>m.isDefault)?.model || '',models:(models.data || []).map((m:any)=>({id:m.model,name:m.displayName,efforts:(m.supportedReasoningEfforts || []).map((e:any)=>e.reasoningEffort)}))};
  } finally {client.close();}
}
