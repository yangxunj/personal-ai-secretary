import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime, SessionManager, SettingsManager, createAgentSession, createExtensionRuntime } from '@earendil-works/pi-coding-agent';

export const configFingerprint = cfg => createHash('sha256').update(cfg.baseUrl.replace(/\/+$/, '')+'\n'+cfg.model).digest('hex');
// Conservative preflight for uploads/new prompts, before the first usage receipt.
// Pi still owns compaction; this only rejects a single request that cannot fit.
function tokens(value){const s=JSON.stringify(value);let wide=0;for(const ch of s)if(/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/u.test(ch))wide++;return wide+Math.ceil((s.length-wide)/3);}
export async function openPiSession({ directory, cfg, instructions, tools, contextWindow = 128000, history = [], fetchImpl = fetch }) {
  if(!Number.isInteger(contextWindow)||contextWindow<8192||contextWindow>1000000)throw new Error('Pi context window must be between 8192 and 1000000');
  const url=new URL(cfg.baseUrl);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Invalid Pi API URL');
  await fs.mkdir(directory,{recursive:true});
  const manifestFile=path.join(directory,'manifest.json');let manifest;
  try {manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(manifest&&manifest.fingerprint!==configFingerprint(cfg))throw new Error('Pi API address or model changed. Start a new chat to preserve the original conversation.');
  const models=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
  const maxTokens=Math.min(32768,Math.floor(contextWindow/4));
  models.registerProvider('secretary-api',{baseUrl:cfg.baseUrl.replace(/\/+$/,''),api:'openai-completions',models:[{
    id:cfg.model,name:cfg.model,reasoning:false,input:cfg.seesImages?['text','image']:['text'],contextWindow,maxTokens,
    cost:{input:0,output:0,cacheRead:0,cacheWrite:0},
  }]});
  await models.setRuntimeApiKey('secretary-api',cfg.apiKey);
  const nativeStream=models.streamSimple.bind(models);let requests=0;
  const guardedFetch=async(input,init)=>{
    const target=new URL(input instanceof Request?input.url:input);
    if(target.href!==url.href.replace(/\/+$/,'')+'/chat/completions'||init?.method!=='POST'||++requests>48)throw new Error('Pi request limit or endpoint mismatch');
    const signal=AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(120000)]);
    return fetchImpl(input,{...init,signal,redirect:'error'});
  };
  models.streamSimple=(model,context,options={})=>nativeStream(model,context,{...options,maxRetries:0,maxTokens,fetch:guardedFetch,
    onPayload:payload=>{
      // Base64 image bytes are not text tokens. Budget image blocks separately.
      const budget=JSON.stringify(payload,(_key,value)=>value?.type==='image_url'?{type:'image',estimatedTokens:'x'.repeat(3600)}:value);
      if(tokens(JSON.parse(budget))+maxTokens>contextWindow)throw new Error('Pi input exceeds the configured context window. Split this message or attachment, or select a larger supported window.');
      return {...payload,max_tokens:maxTokens,...(url.hostname==='api.deepseek.com'?{thinking:{type:'disabled'}}:{})};
    }});
  const resources={getExtensions:()=>({extensions:[],errors:[],runtime:createExtensionRuntime()}),getSkills:()=>({skills:[],diagnostics:[]}),
    getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>({agentsFiles:[]}),
    getSystemPrompt:()=>instructions,getSystemPromptSource:()=>undefined,getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources(){},async reload(){}};
  const sessions=path.join(directory,'sessions');
  let manager;
  if(manifest){
    if(!/^[a-zA-Z0-9_.-]+\.jsonl$/.test(manifest.sessionFile))throw new Error('Invalid Pi session mapping');
    await fs.access(path.join(sessions,manifest.sessionFile));manager=SessionManager.open(path.join(sessions,manifest.sessionFile));
  }else{
    if((await fs.readdir(sessions).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).length)throw new Error('Pi session mapping missing; restore it from backup.');
    manager=SessionManager.create(directory,sessions);
    for(const entry of history)manager.appendCustomMessageEntry('platform-history',entry,false);
    // The SDK persists setup entries only after a conversation message exists.
    // Persist the mapping target now, including cancellation before prompt().
    manager.appendMessage({role:'user',content:[{type:'text',text:'Platform session initialized. No user operation has been requested in this message.'}],timestamp:Date.now()});
  }
  const {session}=await createAgentSession({cwd:directory,agentDir:path.join(directory,'config'),modelRuntime:models,
    model:models.getModel('secretary-api',cfg.model),thinkingLevel:'off',tools:tools.map(t=>t.name),customTools:tools,
    resourceLoader:resources,sessionManager:manager,settingsManager:SettingsManager.inMemory({compaction:{enabled:true,reserveTokens:maxTokens,
      keepRecentTokens:Math.min(16384,Math.floor(contextWindow/8))},retry:{enabled:false,maxRetries:0}})});
  manifest ??= {fingerprint:configFingerprint(cfg),sessionFile:path.basename(manager.getSessionFile()),importedMessages:history.length};
  const saveManifest=async patch=>{Object.assign(manifest,patch);const temp=manifestFile+'.tmp';await fs.writeFile(temp,JSON.stringify(manifest),{mode:0o600});await fs.rename(temp,manifestFile);};
  await saveManifest({});
  return {session,manager,manifest,saveManifest,get requests(){return requests;}};
}

// Hide internal citation tokens even when they are split across streamed deltas.
export class CitationStream {
  constructor(){this.buffer='';this.sources=new Map();this.used=[];this.text='';}
  register(token,source){this.sources.set(token,source);}
  push(delta,finish=false){
    this.buffer+=delta;let output='';const prefix='[[cite:';
    while(this.buffer){
      const at=this.buffer.indexOf(prefix);
      if(at===-1){let keep=0;if(!finish)for(let n=1;n<prefix.length;n++)if(this.buffer.endsWith(prefix.slice(0,n)))keep=n;
        output+=this.buffer.slice(0,this.buffer.length-keep);this.buffer=this.buffer.slice(this.buffer.length-keep);break;}
      output+=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at);
      const end=this.buffer.indexOf(']]');if(end===-1){if(finish||this.buffer.length>256){output+='（来源未核实）';this.buffer='';}break;}
      const token=this.buffer.slice(prefix.length,end),source=this.sources.get(token);
      if(source){let number=this.used.findIndex(s=>s.attachmentId===source.attachmentId&&s.locator===source.locator)+1;
        if(!number){this.used.push(source);number=this.used.length;}output+=`[〔${number}〕](${source.url})`;
      }else output+='（来源未核实）';
      this.buffer=this.buffer.slice(end+2);
    }
    this.text+=output;return output;
  }
  appendix(){return this.used.length?'\n\n'+this.used.map((s,i)=>`〔${i+1}〕[${String(s.filename).replace(/[\[\]\\]/g,'')} · ${s.locator}](${s.url})`).join('\n\n'):'';}
}
