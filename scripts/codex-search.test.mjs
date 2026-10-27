import test from 'node:test';
import assert from 'node:assert/strict';
import { codexArguments, codexSearchConfig, collectWebSources, WebCitationStream, finalizeWebCitations, codexWebGuide } from '../src/lib/codex/web-search.mjs';

const item={id:'w1',type:'mcpToolCall',server:'codex_apps',tool:'search_service.web_run',status:'completed',result:{content:[{type:'text',text:'Official [page] (https://example.com/a_(b))\n【turn1view0】 [wordlim: 200]\nPublic text.'}]}};
test('startup and thread policy restrict apps to one search tool and default off',()=>{
  assert.equal(codexSearchConfig().web_search,'disabled');
  assert.throws(()=>codexSearchConfig('all'));
  for(const mode of ['live','disabled']){
    const args=codexArguments(mode),cfg=codexSearchConfig(mode);
    assert.ok(args.includes('--no-daemon'));assert.ok(args.includes('daemon_auto_start'));
    assert.equal(args[args.indexOf('shell_tool')-1],'--disable');
    for(const flag of ['plugins','browser_use','computer_use','sleep_tool'])assert.equal(args[args.indexOf(flag)-1],'--disable');
    assert.equal(args[args.indexOf('apps')-1],mode==='live'?'--enable':'--disable');
    assert.equal(cfg.apps._default.enabled,false);assert.equal(cfg['features.apps'],mode==='live');
    if(mode==='live'){
      assert.deepEqual(Object.keys(cfg.apps),['_default','connector_openai_search_service']);
      const app=cfg.apps.connector_openai_search_service;assert.equal(app.destructive_enabled,false);assert.equal(app.default_tools_enabled,false);assert.deepEqual(Object.keys(app.tools),['web_run']);
    }else assert.deepEqual(Object.keys(cfg.apps),['_default']);
  }
  const a=codexSearchConfig('live');a.apps.connector_openai_search_service.enabled=false;assert.equal(codexSearchConfig('live').apps.connector_openai_search_service.enabled,true);
  assert.match(codexWebGuide('live'),/system2_search_query/);assert.match(codexWebGuide('disabled'),/disabled for this turn/);
});
test('sources require successful current-turn search outputs, never another connector or credentials',()=>{
  const sources=new Map();
  for(const patch of [{status:'failed'},{error:'x'},{server:'other'},{tool:'other'},{result:{isError:true,content:item.result.content}}])collectWebSources(sources,{...item,...patch});
  assert.equal(sources.size,0);collectWebSources(sources,item);assert.equal(sources.size,1);
  assert.equal(finalizeWebCitations('Verifiedciteturn1view0',sources),'Verified[Official page](https://example.com/a_%28b%29)');
  assert.match(finalizeWebCitations('citeoldSource',sources),/未核实/);
  collectWebSources(sources,{...item,result:{content:[{type:'text',text:'Private (https://user:secret@example.com/)\n【turn2view0】\nLocal (http://127.0.0.1/)\n【turn2view1】'}]}});assert.equal(sources.size,1);
});
test('stream citation conversion handles every delta boundary, oversized tokens and multiple sources',()=>{
  const sources=new Map();collectWebSources(sources,item);
  const input='Answer citeturn1view0unknown. Plain [[cite:platform]] [URL](https://example.org/)';
  for(let split=0;split<=input.length;split++){
    const stream=new WebCitationStream(sources),out=stream.push(input.slice(0,split))+stream.push(input.slice(split))+stream.push('',true);
    assert.equal(out,finalizeWebCitations(input,sources));assert.doesNotMatch(out,/|/);assert.match(out,/\[\[cite:platform\]\]/);
  }
  const stream=new WebCitationStream(sources);assert.match(stream.push('cite'+'x'.repeat(2000)),/未核实/);assert.equal(stream.buffer.length,0);assert.equal(stream.push('hidden payloadvisible'),'visible');
});
