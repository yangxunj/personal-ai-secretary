import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runFileScenarios({db,chat,scenarios,threads,rounds,origin}) {
  for(const s of scenarios){
    if(s.existing){
      await chat(s.id,'Recall only the exact synthetic marker from earlier. Do not use tools.');
      const conv=await db.conversation.findUniqueOrThrow({where:{id:s.id}}),reply=await db.message.findFirst({where:{conversationId:s.id,role:'secretary'},orderBy:{createdAt:'desc'}});
      threads.add(conv.codexThreadId);assert.equal(conv.codexThreadId,s.oldThread);assert.ok(reply.content.includes(s.marker));
      const state=await (await fetch(origin+'/api/agent/state?conversationId='+s.id)).json();assert.equal(state.fileToolsAvailable,false);
      assert.equal(await db.codexToolRun.count({where:{turn:{conversationId:s.id}}}),0);
      rounds.push({taskMode:s.taskMode,existing:true,memoryRetained:true,fileToolsAvailable:false});
    }else{
      const marker='END-'+randomUUID(),body='BEGIN-'+randomUUID()+'\n'+'Synthetic evidence. '.repeat(4000)+'\n'+marker;
      const file={type:'file',url:'data:text/plain;base64,'+Buffer.from(body).toString('base64'),mediaType:'text/plain',filename:'large-evidence.txt'};
      const chunks=await chat(s.id,'Use readAttachment to read the original attachment beginning, then continue at its tail using expectedVersion. Find the exact final END- marker (it is beyond the upload preview). Create a new file named evidence-result.md containing only that marker. Briefly report the marker with the original attachment citation and the new file link. Do not use web search or business tools.',[file]);
      const conv=await db.conversation.findUniqueOrThrow({where:{id:s.id}});threads.add(conv.codexThreadId);
      const reply=await db.message.findFirst({where:{conversationId:s.id,role:'secretary'},orderBy:{createdAt:'desc'}});assert.ok(reply.content.includes(marker));assert.match(reply.content,/api\/files\//);assert.doesNotMatch(reply.content,/\[\[cite:||来源未核实/);
      assert.doesNotMatch(chunks.filter(c=>c.type==='text-delta').map(c=>c.delta).join(''),/\[\[cite:|来源未核实/);
      const reads=await db.codexToolRun.findMany({where:{turn:{conversationId:s.id},name:'readAttachment',status:'completed'}});assert.ok(reads.length>=2);
      assert.ok(reads.some(r=>{const a=JSON.parse(r.inputJson),out=JSON.parse(r.resultJson);return a.offset>40960&&a.expectedVersion&&out.text.includes(marker)&&out.nextOffset===null;}),'No versioned original tail read');
      const output=await db.attachment.findFirst({where:{message:{conversationId:s.id},uploadedBy:'secretary'}});assert.ok(output);assert.equal(output.taskId,conv.taskId);assert.equal((await (await fetch(origin+'/api/files/'+output.id)).text()).trim(),marker);
      assert.equal(await db.attachment.count({where:{message:{conversationId:s.id},uploadedBy:'user'}}),1);
      await chat(s.id,'Use readConversationHistory to check the earlier filename. Then use readAttachment to read the original tail again with the saved version, and cite the final END- marker using a new source token from this turn. Do not create another file.');
      const later=await db.message.findFirst({where:{conversationId:s.id,role:'secretary'},orderBy:{createdAt:'desc'}});assert.ok(later.content.includes(marker));assert.doesNotMatch(later.content,/\[\[cite:|来源未核实/);
      assert.ok(await db.codexToolRun.count({where:{turn:{conversationId:s.id},name:'readConversationHistory',status:'completed'}}));
      assert.equal(await db.attachment.count({where:{message:{conversationId:s.id},uploadedBy:'secretary'}}),1);
      const state=await (await fetch(origin+'/api/agent/state?conversationId='+s.id)).json();assert.equal(state.fileToolsAvailable,true);
      rounds.push({taskMode:s.taskMode,existing:false,versionedTail:true,citations:true,outputFile:true,resumedTools:true});
    }
    console.log(JSON.stringify(rounds.at(-1)));
  }
}
