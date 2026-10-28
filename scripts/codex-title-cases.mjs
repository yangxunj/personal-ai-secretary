import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function runTitleScenarios({db,chat,origin,threads,restart}) {
  await db.setting.upsert({where:{key:'locale'},create:{key:'locale',value:'zh'},update:{value:'zh'}});
  await db.setting.update({where:{key:'codex.webSearch'},data:{value:'false'}});
  const waitTitle=async id=>{
    for(let i=0;i<100;i++){
      const r=await fetch(origin+'/api/chat/title?conversationId='+id,{signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);const state=await r.json();
      if(state.status==='auto')return state;
      if(state.status==='failed')throw new Error('Title failed after bounded attempts');
      await new Promise(r=>setTimeout(r,1000));
    }throw new Error('Title completion timeout');
  };
  const seedCompleted=async id=>{
    for(let i=0;i<2;i++){
      const turn=await db.codexTurn.create({data:{conversationId:id,requestKey:randomUUID(),inputHash:'synthetic-title',processKey:'fixture',status:'completed'}});
      const user=await db.message.create({data:{conversationId:id,role:'user',content:i?'重点比较交通与酒店费用。':'这段对话是关于周末杭州旅行预算的讨论。'}});
      await db.message.create({data:{id:turn.id,conversationId:id,role:'secretary',content:'我们核对旅行费用和可选方案。'}});
      await db.codexTurn.update({where:{id:turn.id},data:{userMessageId:user.id}});
    }
  };
  const conv=await db.conversation.create({data:{backend:'codex'}}),marker='橙叶-'+randomUUID().slice(0,5);
  await chat(conv.id,'这是合成测试对话，主题是周末杭州旅行预算。行程代号是'+marker+'。请记住，只回复已记住，不调用任何工具。');
  const first=await db.conversation.findUniqueOrThrow({where:{id:conv.id}});threads.add(first.codexThreadId);assert.equal(first.title,null);
  assert.equal(JSON.parse((await db.setting.findUniqueOrThrow({where:{key:'conversation.title.'+conv.id}})).value).status,'waiting');
  await chat(conv.id,'这次预算重点是交通和酒店，请用一句话确认，不调用任何工具。');
  const activity=(await db.conversation.findUniqueOrThrow({where:{id:conv.id}})).updatedAt;
  const automatic=await waitTitle(conv.id);assert.match(automatic.title,/旅行|杭州|预算|交通|酒店/);
  const named=await db.conversation.findUniqueOrThrow({where:{id:conv.id}});assert.equal(named.codexThreadId,first.codexThreadId);assert.equal(named.updatedAt.toISOString(),activity.toISOString());
  console.log('PASS two saved Codex turns generate an ephemeral title without moving activity or replacing the main thread');
  await chat(conv.id,'请原样复述开头的行程代号和前面确定的两类预算支出，不使用任何工具。');
  const reply=await db.message.findFirstOrThrow({where:{conversationId:conv.id,role:'secretary'},orderBy:{createdAt:'desc'}});assert.ok(reply.content.includes(marker));assert.match(reply.content,/交通/);assert.match(reply.content,/酒店/);
  const legacy=await db.conversation.create({data:{backend:'codex',title:'合成旧名称'}});await seedCompleted(legacy.id);
  assert.equal((await (await fetch(origin+'/api/chat/title?conversationId='+legacy.id)).json()).title,'合成旧名称');
  const response=await fetch(origin+'/api/chat/title',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({conversationId:legacy.id})});assert.equal(response.status,202);const regenerated=await waitTitle(legacy.id);assert.notEqual(regenerated.title,'合成旧名称');
  const recovered=await db.conversation.create({data:{backend:'codex',title:'恢复前的合成标题'}});await seedCompleted(recovered.id);
  await db.setting.create({data:{key:'conversation.title.'+recovered.id,value:JSON.stringify({version:1,revision:randomUUID(),status:'running',attempts:1,locale:'zh',expectedTitle:recovered.title,retryAt:0,owner:'previous-test-process',pid:2147483640,leaseUntil:Date.now()+60000,forced:true})}});
  await restart();const restored=await waitTitle(recovered.id);assert.notEqual(restored.title,recovered.title);
  assert.equal(JSON.parse((await db.setting.findUniqueOrThrow({where:{key:'conversation.title.'+recovered.id}})).value).attempts,2);
  assert.equal(await db.codexToolRun.count(),0);
  console.log('PASS saved excerpts, explicit old-title regeneration and real server-restart recovery; no business tools used');
  return {conversationId:conv.id,legacyId:legacy.id,recoveredId:recovered.id,mainThreadId:first.codexThreadId,automaticTitle:automatic.title,regeneratedTitle:regenerated.title,recoveredTitle:restored.title,mainMemoryRetained:true,activityPreserved:true,successfulMainTurns:3,titleScenarios:3};
}
