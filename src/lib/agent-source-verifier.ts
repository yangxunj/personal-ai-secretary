import type { AgentSource } from '@/lib/agent-citations.mjs';
import { verifyAgentSource } from '@/lib/agent-files';
import { verifyRecordSource } from '@/lib/agent-records';
export async function verifyPlatformSource(source:AgentSource,conversationId:string,taskId:string|null,assistantMessageId:string){
  if(source.kind==='web')return;
  if(source.kind==='record')await verifyRecordSource(source,conversationId,taskId,assistantMessageId);
  else await verifyAgentSource(source,conversationId,taskId);
}
