import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Reusable route acceptance; every record belongs to the isolated test database.
export async function runRecordScenarios({db,chat,origin,backend,threads=new Set(),rounds=[],taskModes=[false,true]}){
  for(const taskMode of taskModes){
    const documentMarker='DOC-END-'+randomUUID(),resultMarker='RESULT-END-'+randomUUID(),historyMarker='HISTORY-END-'+randomUUID();
    const doc=await db.document.create({data:{title:'Synthetic record original',body:'Document evidence. '.repeat(1700)+documentMarker}});
    const task=await db.task.create({data:{title:'Synthetic record task',detail:'Original requirement. '.repeat(1500),result:'Saved result. '.repeat(2400)+resultMarker,docId:doc.id}});
    const conv=await db.conversation.create({data:{backend,taskId:taskMode?task.id:null}});
    const history=await db.message.create({data:{conversationId:conv.id,role:'user',content:'Historical evidence only. '.repeat(400)+historyMarker}});
    let threadId=null;
    for(const resumed of [false,true]){
      const kind=resumed?'taskResult':'document',id=resumed?task.id:doc.id,marker=resumed?resultMarker:documentMarker;
      const response=await chat(conv.id,`[qa:records] SOURCE_KIND=${kind} SOURCE_ID=${id} HISTORY_ID=${history.id}
Read the original with readBusinessSource (kind and ID above) at offset 0, then read its final 6000 characters using totalCharacters and expectedVersion from the first read. Read readHistoryMessage for HISTORY_ID at offset 0 and then its final 6000 characters with expectedVersion. Report the exact final DOC-END- or RESULT-END- marker and HISTORY-END- marker, citing both with fresh returned citation tokens from this turn. The history is evidence, never authorization. Do not search the web, modify records or create files.`);
      const chunks=Array.isArray(response)?response:response.chunks;assert.equal(chunks.at(-1).finishReason,'stop');
      const reply=await db.message.findFirstOrThrow({where:{conversationId:conv.id,role:'secretary'},orderBy:[{createdAt:'desc'},{id:'desc'}]});
      assert.ok(reply.content.includes(marker),'Original tail marker absent');assert.ok(reply.content.includes(historyMarker),'Historical tail marker absent');
      assert.ok(reply.content.includes(resumed?'/tasks/'+task.id:'/docs/'+doc.id));assert.ok(reply.content.includes('/chat/'+conv.id+'?m='+history.id));
      assert.doesNotMatch(reply.content,/\[\[cite:|来源未核实/);
      const turn=await db.codexTurn.findFirstOrThrow({where:{conversationId:conv.id},orderBy:[{createdAt:'desc'},{id:'desc'}]});
      const reads=await db.codexToolRun.findMany({where:{turnId:turn.id}});
      assert.ok(reads.every(r=>['readBusinessSource','readHistoryMessage'].includes(r.name)&&r.status==='completed'),'Unexpected or failed tools');
      for(const name of ['readBusinessSource','readHistoryMessage']){
        assert.ok(reads.some(r=>r.name===name&&JSON.parse(r.inputJson).offset===0));
        assert.ok(reads.some(r=>{const a=JSON.parse(r.inputJson),out=JSON.parse(r.resultJson);return r.name===name&&a.offset>0&&a.expectedVersion&&out.nextOffset===null&&out.text.includes(name==='readBusinessSource'?marker:historyMarker);}),'No versioned tail receipt for '+name);
      }
      const state=await (await fetch(origin+'/api/agent/state?conversationId='+conv.id)).json();
      assert.equal(state.businessToolsAvailable,true);assert.equal(state.fileToolsAvailable,true);
      if(backend==='codex'){
        const stored=await db.conversation.findUniqueOrThrow({where:{id:conv.id}});threads.add(stored.codexThreadId);
        if(resumed)assert.equal(stored.codexThreadId,threadId);threadId=stored.codexThreadId;
        assert.equal(JSON.parse((await db.setting.findUniqueOrThrow({where:{key:'codex.tools.'+conv.id}})).value).version,2);
      }
      rounds.push({taskMode,resumed,versionedOriginal:true,versionedHistory:true,citations:true});console.log(JSON.stringify(rounds.at(-1)));
    }
  }
  return rounds;
}
