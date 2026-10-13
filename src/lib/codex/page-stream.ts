import { openCodex } from './config';
import { denyRequest, runTurn } from './protocol.mjs';

export type PageDelta = {type:'text-delta' | 'reasoning-delta';text:string};
export async function* codexPageStream(system: string, prompt: string, abortSignal?: AbortSignal): AsyncGenerator<PageDelta> {
  const {client,cfg,cwd,config}=await openCodex();
  const queue:PageDelta[]=[];let wake:(()=>void)|undefined,finished=false,error:unknown;
  const abort=()=>client.close();abortSignal?.addEventListener('abort',abort,{once:true});
  client.on('request',msg=>denyRequest(client,msg));
  try {
    if(abortSignal?.aborted)throw new Error('Aborted');
    const models=await client.request('model/list',{});
    const model=cfg.model ? models.data?.find((m:any)=>m.model===cfg.model) : models.data?.find((m:any)=>m.isDefault);
    const efforts=(model?.supportedReasoningEfforts || []).map((e:any)=>e.reasoningEffort);
    const effort=['max','xhigh','high','medium','low'].find(e=>efforts.includes(e)) || cfg.effort;
    const r=await client.request('thread/start',{cwd,config,...(cfg.model?{model:cfg.model}:{}),sandbox:'read-only',approvalPolicy:'on-request',ephemeral:true,baseInstructions:system,developerInstructions:'Only output the requested HTML. No terminal commands, file editing, skills, plugins or external tools.',dynamicTools:[]});
    const job=runTurn(client,{threadId:r.thread.id,effort,input:[{type:'text',text:prompt}],onEvent:msg=>{
      if(msg.method==='item/agentMessage/delta')queue.push({type:'text-delta',text:msg.params.delta});
      else if(msg.method==='item/reasoning/summaryTextDelta')queue.push({type:'reasoning-delta',text:msg.params.delta});
      wake?.();
    }}).then(()=>{finished=true;wake?.();},e=>{error=e;finished=true;wake?.();});
    while(!finished || queue.length){if(queue.length)yield queue.shift()!;else await new Promise<void>(r=>{wake=r;});}
    await job;if(error)throw error;
  } finally {abortSignal?.removeEventListener('abort',abort);client.close();}
}
