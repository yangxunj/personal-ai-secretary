import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runPiTitleScenarios({db,origin,uploads,chat,restart,holdNextTitle,titlePayloads,mainPayloads}) {
  await db.setting.upsert({where:{key:'locale'},create:{key:'locale',value:'en'},update:{value:'en'}});
  const job=async id=>JSON.parse((await db.setting.findUniqueOrThrow({where:{key:'conversation.title.'+id}})).value);
  const waitFor=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw new Error('Pi title condition timeout');};
  const force=id=>fetch(origin+'/api/chat/title',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({conversationId:id})});
  const id=randomUUID().replaceAll('-','');
  await chat(id,'Remember synthetic travel marker LEAF-J7X9. Reply OK only.');
  assert.equal((await job(id)).status,'waiting');assert.equal(titlePayloads.length,0);
  await chat(id,'Focus the travel budget on transport and hotels.');
  const activity=(await db.conversation.findUniqueOrThrow({where:{id}})).updatedAt;
  await waitFor(async()=> (await job(id)).status==='auto');
  const named=await db.conversation.findUniqueOrThrow({where:{id}});
  assert.equal(named.title,'Travel budget planning');assert.equal(named.updatedAt.toISOString(),activity.toISOString());
  assert.equal(titlePayloads.length,1);assert.equal(await db.codexToolRun.count(),0);
  const piDir=path.resolve(uploads,'../pi-sessions',id);
  const manifest=await fs.readFile(path.join(piDir,'manifest.json'),'utf8');
  const sessionPath=path.join(piDir,'sessions',JSON.parse(manifest).sessionFile);
  const sessionBefore=await fs.readFile(sessionPath,'utf8');
  const excerpt=JSON.parse(titlePayloads[0].messages.find(m=>m.role==='user').content);
  assert.equal(excerpt.messages.length,4);assert.match(JSON.stringify(excerpt),/LEAF-J7X9/);
  console.log('PASS Pi title runs after two saved turns without browser polling or local Codex');
  const legacy=await db.conversation.create({data:{backend:'pi',title:'Keep old name'}});
  for(let i=0;i<2;i++){
    const turn=await db.codexTurn.create({data:{conversationId:legacy.id,requestKey:randomUUID(),inputHash:'synthetic-title',processKey:'fixture',status:'completed'}});
    const user=await db.message.create({data:{conversationId:legacy.id,role:'user',content:'Synthetic travel budget'}});
    await db.message.create({data:{id:turn.id,conversationId:legacy.id,role:'secretary',content:'Transport and hotels'}});
    await db.codexTurn.update({where:{id:turn.id},data:{userMessageId:user.id}});
  }
  const status=await (await fetch(origin+'/api/chat/title?conversationId='+legacy.id)).json();assert.equal(status.title,'Keep old name');assert.equal(status.canRegenerate,true);
  assert.equal((await force(legacy.id)).status,202);await waitFor(async()=> (await job(legacy.id)).status==='auto');
  const blocked=holdNextTitle();assert.equal((await force(legacy.id)).status,202);await blocked;
  assert.equal((await job(legacy.id)).status,'running');await restart();await waitFor(async()=> (await job(legacy.id)).status==='auto');
  assert.equal((await job(legacy.id)).attempts,2);
  assert.equal(await fs.readFile(path.join(piDir,'manifest.json'),'utf8'),manifest);
  assert.equal(await fs.readFile(sessionPath,'utf8'),sessionBefore);
  await chat(id,'After restart, recall the previous synthetic travel marker.');
  assert.match(JSON.stringify(mainPayloads.at(-1).messages),/LEAF-J7X9/);
  assert.equal((await db.conversation.findUniqueOrThrow({where:{id}})).title,'Travel budget planning');
  console.log('PASS Pi old-name regeneration and interrupted title recover across an actual process restart');
  return {conversationId:id,legacyId:legacy.id,titleRequests:titlePayloads.length,checks:['two saved turns','no browser needed','Codex disabled','no tools in title request','activity retained','old names retained until requested','actual restart recovery','main session bytes unchanged by titles','history retained after restart']};
}
