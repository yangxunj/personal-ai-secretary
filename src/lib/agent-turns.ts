import { createHash, randomUUID } from 'node:crypto';
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage, type UIMessageChunk } from 'ai';
import type { CodexTurn } from '@prisma/client';
import { z } from 'zod';
import { db, inDatabaseTransaction } from '@/lib/db';
import type { StoredFile } from '@/lib/ingest';

// The existing CodexTurn/CodexToolRun SQL names are retained for compatibility.
// Both durable runtimes use this acceptance, recovery and business transaction boundary.
type Active = {chunks:UIMessageChunk[];listeners:Set<(c:UIMessageChunk)=>void>;done:Promise<void>;cancel:()=>void};
const g=globalThis as unknown as {secretaryAgentRuns?:{key:string;tail:Promise<void>;initialized?:Promise<void>;jobs:Map<string,Active>}};
const state:NonNullable<typeof g.secretaryAgentRuns>=g.secretaryAgentRuns ??= {key:randomUUID(),tail:Promise.resolve(),jobs:new Map()};
export const agentError=(e:unknown)=>e instanceof Error?e.message:String(e);
export async function recoverAgentTurns() {
  state.initialized ??= db.codexTurn.updateMany({where:{status:{in:['queued','running']},processKey:{not:state.key}},data:{status:'failed',error:'Agent backend restarted. Some changes may have been saved; check results before submitting again.'}}).then(()=>{});
  await state.initialized;
}
export async function archiveAgentFiles(incoming:StoredFile[],messageId:string,taskId:string|null) {
  const claimed=await db.attachment.findMany({where:{storedPath:{in:incoming.map(f=>f.storedPath)}},select:{storedPath:true}});
  const taken=new Set(claimed.map(f=>f.storedPath)),files=incoming.filter(f=>!taken.has(f.storedPath));
  if(files.length)await db.attachment.createMany({data:files.map(f=>({...f,messageId,taskId,uploadedBy:'user'}))});
}
export async function durableAgentResponse({conversationId,newest,generate}:{conversationId:string;newest:UIMessage;
  generate:(turn:CodexTurn,emit:(chunk:UIMessageChunk)=>void,signal:AbortSignal)=>Promise<void>}) {
  await recoverAgentTurns();
  if(newest.parts.filter(p=>p.type==='file').length>6 || newest.parts.some(p=>p.type==='text'&&p.text.length>20000 || p.type==='file'&&(!p.url.startsWith('data:')||p.url.length>14*1024*1024)))return new Response('Message or attachment too large or invalid',{status:413});
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(newest.id))return new Response('Invalid message id',{status:400});
  const requestKey=conversationId+':'+newest.id,inputHash=createHash('sha256').update(JSON.stringify(newest.parts)).digest('hex');
  let turn=await db.codexTurn.findUnique({where:{requestKey}});
  if(turn&&turn.inputHash!==inputHash)return new Response('Message id already belongs to different content',{status:409});
  if(!turn)try {
    turn=await db.$transaction(async tx=>{
      const same=await tx.codexTurn.findUnique({where:{requestKey}});if(same)return same;
      if(await tx.codexTurn.findFirst({where:{conversationId,status:{in:['queued','running']}}}))throw new Error('This conversation is still processing. Wait for the reply.');
      return tx.codexTurn.create({data:{requestKey,inputHash,conversationId,processKey:state.key}});
    });
  }catch(e){return new Response(agentError(e),{status:409});}
  if(turn.inputHash!==inputHash)return new Response('Message id already belongs to different content',{status:409});
  let job=state.jobs.get(turn.id);
  if(!job&&turn.status==='queued'&&turn.processKey===state.key) {
    const chunks:UIMessageChunk[]=[],listeners=new Set<(c:UIMessageChunk)=>void>(),abort=new AbortController(),accepted=turn;
    const emit=(c:UIMessageChunk)=>{chunks.push(c);for(const listener of listeners)listener(c);};
    const work=state.tail.then(()=>generate(accepted,emit,abort.signal));state.tail=work.catch(()=>{});
    job={chunks,listeners,done:work,cancel:()=>abort.abort()};state.jobs.set(turn.id,job);
    void work.finally(()=>state.jobs.delete(accepted.id)).catch(()=>{});
  }
  const active=job,stored=turn;
  return createUIMessageStreamResponse({stream:createUIMessageStream({execute:async({writer})=>{
    if(active){for(const c of active.chunks)writer.write(c);const listener=(c:UIMessageChunk)=>writer.write(c);active.listeners.add(listener);try{await active.done;}finally{active.listeners.delete(listener);}}
    else if(stored.chunksJson){for(const c of JSON.parse(stored.chunksJson))writer.write(c);}
    else {writer.write({type:'start',messageId:stored.id});writer.write({type:'error',errorText:stored.error||'Turn unavailable; check conversation history.'});writer.write({type:'finish',finishReason:'error'});}
  },onError:agentError})});
}
export async function cancelAgentConversation(conversationId:string) {
  const turns=await db.codexTurn.findMany({where:{conversationId,status:{in:['queued','running']}}});
  for(const turn of turns)state.jobs.get(turn.id)?.cancel();
}

export async function executeAgentTool({turnId,callId,name,args,def,signal,progress}:{turnId:string;callId:string;name:string;args:unknown;
  def:any;signal:AbortSignal;progress?:(value:unknown)=>void}) {
  if(signal.aborted)throw new Error('Cancelled');
  if(!def?.execute)throw new Error('Unknown platform tool');
  const parsed=(def.inputSchema as z.ZodType).parse(args),inputJson=JSON.stringify(parsed);
  const existing=await db.codexToolRun.findUnique({where:{turnId_callId:{turnId,callId}}});
  if(existing){
    if(existing.status!=='completed')throw new Error('Tool was interrupted; check saved data before retrying.');
    if(existing.name!==name||existing.inputJson!==inputJson)throw new Error('Tool call id mismatch');
    return JSON.parse(existing.resultJson!);
  }
  const audit=await db.codexToolRun.create({data:{turnId,callId,name,inputJson}});
  try {
    if(name==='buildPage') {
      let result:unknown;
      for await(const value of def.execute(parsed,{toolCallId:callId,messages:[],abortSignal:signal})){
        if(signal.aborted)throw new Error('Cancelled; check saved data before retrying.');result=value;progress?.(value);
      }
      await db.codexToolRun.update({where:{id:audit.id},data:{status:'completed',resultJson:JSON.stringify(result??null)}});return result;
    }
    return await db.$transaction(tx=>inDatabaseTransaction(tx,async()=>{
      if(signal.aborted)throw new Error('Cancelled');
      const value=await def.execute(parsed,{toolCallId:callId,messages:[],abortSignal:signal});
      if(signal.aborted)throw new Error('Cancelled');
      await db.codexToolRun.update({where:{id:audit.id},data:{status:'completed',resultJson:JSON.stringify(value??null)}});return value;
    }),{timeout:30000});
  }catch(e){await db.codexToolRun.updateMany({where:{id:audit.id,status:'running'},data:{status:'failed',resultJson:JSON.stringify({ok:false,error:agentError(e)})}});throw e;}
}
