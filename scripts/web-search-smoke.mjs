#!/usr/bin/env node
// Explicit paid provider smoke; public fixture only, no business database or files.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './responses-pilot.mjs';
import { createSearchClient, publicWebUrl } from '../src/lib/web-search/client.mjs';

if(!process.argv.includes('--live'))throw new Error('Pass --live to make two paid public Search/Fetch requests');
const root=path.resolve(import.meta.dirname,'..'),cfg=loadConfig(root,{provider:'deepseek'});
const client=createSearchClient({apiKey:cfg.apiKey,maxCalls:2});
try {
  const search=await client.request('search',{query:'site:api-docs.deepseek.com Search Fetch API',count:2,need_content:false});
  assert.ok(Array.isArray(search.results)&&search.results.length>0,'No search results');
  assert.ok(search.results.some(r=>{try{return !!publicWebUrl(r.url);}catch{return false;}}));
  const page=await client.request('fetch',{url:'https://api-docs.deepseek.com/api/search/'});
  assert.ok(typeof page.content==='string'&&page.content.length>0,'No page content');
  const receipt={status:'passed',checkedAt:new Date().toISOString(),provider:'deepseek',requests:client.calls,checks:['real public search results','real public page text'],resultCount:search.results.length,pageCharacters:page.content.length};
  const dir=path.join(root,'data/web-search-smoke');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
} catch(e) {console.error(e.message);process.exitCode=1;}
