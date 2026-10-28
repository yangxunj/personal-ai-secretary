#!/usr/bin/env node
// Explicit isolated provider pilot. Public queries only; no business tools or writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './responses-pilot.mjs';

if(!process.argv.includes('--live'))throw new Error('Pass --live for a small paid public search pilot');
const mode=process.argv.find(a=>a.startsWith('--mode='))?.slice(7)||'probe';
if(!['probe','native','responses','extract'].includes(mode))throw new Error('Unknown pilot mode');
const cfg=loadConfig();
if(new URL(cfg.baseUrl).hostname!=='dashscope.aliyuncs.com')throw new Error('Pilot requires the configured Beijing DashScope provider');
const dir=path.resolve('data/dashscope-search-pilot',new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(dir,{recursive:true});
const report={at:new Date().toISOString(),model:cfg.model,host:new URL(cfg.baseUrl).host,syntheticOnly:true,applicationIntegrationVerified:false,requests:[]};
const save=()=>fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(report,null,2));
let seq=0,sessionId;
const request=async(label,url,body,headers={})=>{
  if(++seq>10)throw new Error('Pilot request cap');
  const started=Date.now(),receipt={label,status:null,elapsedMs:0};report.requests.push(receipt);
  try {
    const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+cfg.apiKey,'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(55000),redirect:'error'});
    receipt.status=response.status;sessionId=response.headers.get('mcp-session-id')||sessionId;
    const raw=await response.text();if(raw.length>2*1024*1024)throw new Error('Response too large');
    let data;try{data=JSON.parse(raw);}catch{
      const entries=raw.split(/\r?\n/).filter(l=>l.startsWith('data:')).flatMap(l=>{try{return[JSON.parse(l.slice(5).trim())];}catch{return[];}});
      data=entries.findLast(e=>e.id===body.id)||entries.at(-1)||{};
    }
    receipt.ok=response.ok&&!data.error;
    if(!receipt.ok){
      receipt.errorCode=data.error?.code||data.code||'provider_rejected';
      const message=data.error?.message||data.message;
      if(typeof message==='string')receipt.errorDetail=message.replaceAll(cfg.apiKey,'[redacted]').replace(/sk-[\w-]+|Bearer\s+\S+/gi,'[redacted]').slice(0,300);
    }
    return {data,receipt};
  }catch{receipt.ok=false;receipt.errorCode='network_or_protocol';return {data:{},receipt};}
  finally{receipt.elapsedMs=Date.now()-started;await save();console.log(JSON.stringify(receipt));}
};
const question='请联网查询阿里云百炼官方文档中联网搜索的启用方法，简要回答并给出官方来源链接。';
if(mode==='probe'){
  const {data,receipt}=await request('current_chat_search',cfg.baseUrl+'/chat/completions',{model:cfg.model,messages:[{role:'user',content:question}],stream:false,max_tokens:700,enable_thinking:false,enable_search:true,search_options:{forced_search:true},include_tool_usage:true});
  receipt.usage=data.usage;receipt.responseKeys=Object.keys(data);receipt.messageKeys=Object.keys(data.choices?.[0]?.message||{});
  const text=data.choices?.[0]?.message?.content||'';receipt.answerCharacters=text.length;receipt.answerUrls=[...new Set(text.match(/https?:\/\/[^\s\])<>"']+/g)||[])].slice(0,8);receipt.searchInfo=data.search_info||null;
  const endpoint='https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp';
  const init=await request('mcp_initialize',endpoint,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'secretary-search-pilot',version:'1.0'}}},{Accept:'application/json, text/event-stream'});
  if(init.receipt.ok&&init.data.result){
    await request('mcp_initialized',endpoint,{jsonrpc:'2.0',method:'notifications/initialized'},{Accept:'application/json, text/event-stream',...(sessionId?{'Mcp-Session-Id':sessionId}:{})});
    const listed=await request('mcp_tools_list',endpoint,{jsonrpc:'2.0',id:2,method:'tools/list',params:{}},{Accept:'application/json, text/event-stream',...(sessionId?{'Mcp-Session-Id':sessionId}:{})});
    report.mcpTools=listed.data.result?.tools||[];
    const tool=report.mcpTools.find(t=>/search/i.test(t.name));
    if(tool){
      const args={query:'阿里云百炼 联网搜索 官方文档'};
      const required=tool.inputSchema?.required||[];
      if(required.every(k=>k==='query')){
        const result=await request('mcp_public_search',endpoint,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:tool.name,arguments:args}},{Accept:'application/json, text/event-stream',...(sessionId?{'Mcp-Session-Id':sessionId}:{})});
        const text=JSON.stringify(result.data.result||{});result.receipt.isError=result.data.result?.isError===true;result.receipt.resultCharacters=text.length;
        result.receipt.urls=[...new Set(text.match(/https?:\/\/[^\s\\"<>]+/g)||[])].slice(0,8);
      }
    }
  }
}else if(mode==='native'){
  const {data,receipt}=await request('native_search_sources','https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',{model:cfg.model,input:{messages:[{role:'user',content:question}]},parameters:{result_format:'message',enable_search:true,enable_thinking:false,max_tokens:700,search_options:{forced_search:true,enable_source:true,enable_citation:true}}});
  receipt.usage=data.usage;receipt.searchInfo=data.output?.search_info||data.search_info||null;receipt.answerCharacters=(data.output?.choices?.[0]?.message?.content||'').length;
}else if(mode==='responses'||mode==='extract'){
  const model=process.argv.find(a=>a.startsWith('--model='))?.slice(8)||cfg.model;
  const extract=mode==='extract';
  const {data,receipt}=await request(extract?'responses_extract':'responses_search',cfg.baseUrl+'/responses',{model,input:extract?'请使用网页读取工具打开 https://help.aliyun.com/zh/model-studio/web-search ，根据原文回答 Chat Completions 用什么参数开启联网搜索。只打开一次，不搜索其他网页，回答不超过80字。':'只执行一次联网搜索：阿里云百炼联网搜索官方文档。找到官方来源后直接用一句话和一个链接回答，不继续搜索。',tools:extract?[{type:'web_search'},{type:'web_extractor'}]:[{type:'web_search'}],max_output_tokens:2000,store:false,reasoning:{effort:extract?'low':'none'}});
  receipt.model=model;
  receipt.outputTypes=(data.output||[]).map(i=>i.type);receipt.usage=data.usage;receipt.responseStatus=data.status;
  receipt.searchCalls=(data.output||[]).filter(i=>i.type==='web_search_call');
  receipt.sources=(data.output||[]).filter(i=>i.type==='message').flatMap(m=>(m.content||[]).flatMap(c=>c.annotations||[]));
  const text=(data.output||[]).filter(i=>i.type==='message').flatMap(m=>(m.content||[]).filter(c=>c.type==='output_text').map(c=>c.text||'')).join('');
  receipt.answerCharacters=text.length;receipt.answerUrls=[...new Set(text.match(/https?:\/\/[^\s\])<>"']+/g)||[])].slice(0,8);
  receipt.answerMentionsSearchParameter=text.includes('enable_search');
  receipt.extractCalls=(data.output||[]).filter(i=>i.type==='web_extractor_call').map(i=>({type:i.type,status:i.status,action:i.action}));
}
await save();console.log(JSON.stringify({directory:dir,requests:report.requests.map(r=>({label:r.label,status:r.status,ok:r.ok,responseStatus:r.responseStatus,outputTypes:r.outputTypes,usage:r.usage}))}));
