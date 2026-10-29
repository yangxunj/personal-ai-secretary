// This client only contacts DeepSeek. It never fetches a model-supplied URL locally.
export const SEARCH_ENDPOINT='https://api.deepseek.com/v1/tools/';
export function selectSearchKey({dedicatedKey='',baseUrl='',apiKey=''}) {
  try {
    const url=new URL(baseUrl);
    if(url.origin==='https://api.deepseek.com'&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/(v1\/?)?$/.test(url.pathname))return apiKey.trim();
  }catch {}
  // Retain existing custom-provider integrations, without letting a legacy
  // search key override the official DeepSeek chat credential.
  return dedicatedKey.trim();
}
export function publicWebUrl(value) {
  if(typeof value!=='string'||value.length>8192)throw new Error('Invalid public web URL');
  const u=new URL(value),host=u.hostname.toLowerCase().replace(/\.$/,'');
  // Domain names only; no IP literals, single-label hosts, credentials or local suffixes.
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||!host.includes('.')||/[:\[\]]/.test(host)||/^[\d.]+$/.test(host)||/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host))throw new Error('Only public web URLs are supported');
  // Encode Markdown delimiters before rendering a provider-returned URL as a link.
  return u.href.replace(/[()<>\[\]\\]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
}
export function createSearchClient({apiKey,signal,fetchImpl=fetch,maxCalls=6,timeoutMs=25000,maxBytes=2*1024*1024}) {
  let calls=0;
  return {get calls(){return calls;},async request(kind,body){
    if(!['search','fetch'].includes(kind))throw new Error('Unsupported web tool');
    signal?.throwIfAborted();
    if(!apiKey)throw new Error('Configure a DeepSeek search API key in Settings first.');
    if(++calls>maxCalls)throw new Error('Web search turn budget reached');
    const controller=new AbortController();
    const combined=AbortSignal.any([...(signal?[signal]:[]),controller.signal,AbortSignal.timeout(timeoutMs)]);
    try {
      const res=await fetchImpl(SEARCH_ENDPOINT+kind,{method:'POST',redirect:'error',signal:combined,
        headers:{'content-type':'application/json',authorization:'Bearer '+apiKey},body:JSON.stringify(body)});
      if(!res.ok)throw new Error('DeepSeek '+kind+' failed (HTTP '+res.status+').');
      if(Number(res.headers.get('content-length'))>maxBytes)throw new Error('Web tool response too large');
      const reader=res.body?.getReader();if(!reader)throw new Error('Empty web tool response');
      let size=0;const chunks=[];
      try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new Error('Web tool response too large');chunks.push(value);}}
      catch(e){await reader.cancel().catch(()=>{});throw e;}
      finally{reader.releaseLock();}
      combined.throwIfAborted();
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch(e){
      if(combined.aborted)throw new Error(signal?.aborted?'Cancelled':'Web tool timed out');
      // Never return provider response bodies, request headers or API keys in errors.
      if(e instanceof Error&&/^(DeepSeek (search|fetch) failed \(HTTP \d+\)\.|Web tool response too large|Empty web tool response)$/.test(e.message))throw e;
      throw new Error('Web tool request failed');
    }finally{controller.abort();}
  }};
}
