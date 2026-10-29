import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchClient, selectSearchKey, publicWebUrl, SEARCH_ENDPOINT } from '../src/lib/web-search/client.mjs';

test('search credentials never reuse another provider or a deceptive official address',()=>{
  for(const baseUrl of ['https://other.example/v1','http://api.deepseek.com','https://api.deepseek.com.evil.example','https://api.deepseek.com/proxy','https://user@api.deepseek.com','https://api.deepseek.com?key=x'])assert.equal(selectSearchKey({baseUrl,apiKey:'other-secret'}),'');
  for(const baseUrl of ['https://api.deepseek.com','https://api.deepseek.com/v1/'])assert.equal(selectSearchKey({baseUrl,apiKey:'official-secret'}),'official-secret');
  assert.equal(selectSearchKey({dedicatedKey:'dedicated',baseUrl:'https://other.example',apiKey:'other'}),'dedicated');
  assert.equal(selectSearchKey({dedicatedKey:'legacy-key',baseUrl:'https://api.deepseek.com',apiKey:'official-secret'}),'official-secret');
  assert.equal(selectSearchKey({dedicatedKey:'legacy-key',baseUrl:'https://api.deepseek.com',apiKey:''}),'');
});

test('web sources reject nonpublic URLs and escape Markdown delimiters',()=>{
  for(const url of ['file:///tmp/a','http://localhost','http://127.0.0.1','http://2130706433','http://[::1]','https://printer.local/a','https://user:secret@example.com','https://example.com:9000/a','javascript:alert(1)'])assert.throws(()=>publicWebUrl(url));
  assert.equal(publicWebUrl('https://example.com/a_(b)'),'https://example.com/a_%28b%29');
});

test('fixed endpoints, bounded calls and no retries or provider-error leaks',async()=>{
  let requests=0;
  const client=createSearchClient({apiKey:'synthetic-secret',maxCalls:2,fetchImpl:async(url,init)=>{
    requests++;assert.equal(url,SEARCH_ENDPOINT+'search');assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,'Bearer synthetic-secret');
    assert.deepEqual(JSON.parse(init.body),{query:'public question'});return Response.json({results:[]});
  }});
  await client.request('search',{query:'public question'});await client.request('search',{query:'public question'});
  await assert.rejects(client.request('search',{}),/budget/);assert.equal(requests,2);
  const denied=createSearchClient({apiKey:'x',fetchImpl:async()=>new Response('synthetic-secret',{status:401})});
  await assert.rejects(denied.request('fetch',{}),{message:'DeepSeek fetch failed (HTTP 401).'});
  const broken=createSearchClient({apiKey:'x',fetchImpl:async()=>{throw new Error('synthetic-secret');}});
  await assert.rejects(broken.request('fetch',{}),{message:'Web tool request failed'});
  const absent=createSearchClient({apiKey:'',fetchImpl:()=>{throw new Error('must not request');}});
  await assert.rejects(absent.request('search',{}),/Configure/);
});

test('streaming body limit, timeout and cancellation apply through response consumption',async()=>{
  const huge=createSearchClient({apiKey:'x',maxBytes:5,fetchImpl:async()=>new Response('123456')});
  await assert.rejects(huge.request('search',{}),/too large/);
  const slow=(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  const keepAlive=setTimeout(()=>{},1000);
  try {
    await assert.rejects(createSearchClient({apiKey:'x',timeoutMs:20,fetchImpl:slow}).request('search',{}),/timed out/);
    const abort=new AbortController();const pending=createSearchClient({apiKey:'x',signal:abort.signal,fetchImpl:slow}).request('fetch',{});abort.abort();await assert.rejects(pending,/Cancelled/);
    const afterHeaders=new AbortController();
    const body=createSearchClient({apiKey:'x',signal:afterHeaders.signal,fetchImpl:async()=>new Response(new ReadableStream({start(controller){afterHeaders.abort();controller.enqueue(new TextEncoder().encode('{}'));controller.close();}}))});
    await assert.rejects(body.request('search',{}),/Cancelled/);
  } finally {clearTimeout(keepAlive);}
});
