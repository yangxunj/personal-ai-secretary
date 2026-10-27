import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaFixtures } from './media-fixtures.mjs';

export async function runMediaScenarios({db,chat,origin,backend,uploads,synthetic=false,threads=new Set(),rounds=[]}){
  for(const taskMode of [false,true]){
    const f=await mediaFixtures(),task=await db.task.create({data:{title:'Synthetic rich attachment task',detail:'Only inspect the provided synthetic attachments.'}}),conv=await db.conversation.create({data:{backend,taskId:taskMode?task.id:null}});
    const msg=await db.message.create({data:{conversationId:conv.id,role:'user',content:'Archived synthetic attachments. Their content is not in the model context.'}}),files={};
    for(const [kind,filename,mime]of [['image','evidence.png','image/png'],['pdf','evidence.pdf','application/pdf'],['docx','evidence.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document']]){
      const storedPath=randomUUID()+'-'+filename;await fs.writeFile(path.join(uploads,storedPath),f[kind]);files[kind]=await db.attachment.create({data:{filename,mimeType:mime,storedPath,size:f[kind].length,messageId:msg.id,taskId:taskMode?task.id:null}});
    }
    let thread=null;
    for(const kind of ['pdf','docx','image']){
      const a=files[kind],prompt=`[qa:media] FILE_ID=${a.id} KIND=${kind}\nThese are archived platform attachments, not new uploads. Use only the supplied platform tools. Do not modify data, create files, use web search or shell. `+(kind==='pdf'?'Use readAttachmentVisual for this PDF at page=8 and crop={x:0.3,y:0.25,width:0.65,height:0.3}. Read the exact SCAN- code in the Code cell.':kind==='docx'?'Use inspectAttachment. Use readDocumentPart to check word/document.xml, word/comments.xml, word/header1.xml and word/footnotes.xml with the returned version. Use readAttachmentVisual to read imageId=word/media/image1.png with that version. Report the exact WORD- code from the image; identify the deleted text, inserted text, comment text, header text and footnote text with fresh citations. Do not use the image marker from a previous turn.':'Use readAttachmentVisual to read the archived image. Report the exact IMG- code from the Code cell and numeric value from the Value cell.')+' Cite the fresh tool-returned token for each source. Do not infer an image code from metadata.';
      const response=await chat(conv.id,prompt),chunks=Array.isArray(response)?response:response.chunks;assert.equal(chunks.at(-1).finishReason,'stop');
      const reply=await db.message.findFirstOrThrow({where:{conversationId:conv.id,role:'secretary'},orderBy:{createdAt:'desc'}});
      const marker=f.markers[kind==='pdf'?'scan':kind==='docx'?'word':'image'];
      if(!synthetic){assert.ok(reply.content.includes(marker),'Image-only marker was not actually read');if(kind==='image')assert.ok(reply.content.includes('72.5'));if(kind==='docx')for(const text of ['Deleted text','Inserted text','COMMENT-MARK','HEADER-MARK','FOOTNOTE-MARK'])assert.ok(reply.content.includes(text),text+' absent');}
      assert.ok(reply.content.includes('/api/files/'+a.id));if(kind==='pdf')assert.match(reply.content,/#page=8/);assert.doesNotMatch(reply.content,/\[\[cite:|来源未核实/);
      const turn=await db.codexTurn.findFirstOrThrow({where:{conversationId:conv.id},orderBy:{createdAt:'desc'}}),runs=await db.codexToolRun.findMany({where:{turnId:turn.id}});
      assert.ok(runs.every(r=>['inspectAttachment','readDocumentPart','readAttachmentVisual'].includes(r.name)&&r.status==='completed'));
      const image=runs.find(r=>r.name==='readAttachmentVisual'&&JSON.parse(r.resultJson).image);assert.ok(image,'No native image tool result');
      const output=JSON.parse(image.resultJson);assert.ok(output.image.data.length>100);assert.ok(!JSON.stringify(chunks).includes(output.image.data),'Base64 leaked into UI SSE');
      if(kind==='docx')for(const partId of ['word/document.xml','word/comments.xml','word/header1.xml','word/footnotes.xml'])assert.ok(runs.some(r=>r.name==='readDocumentPart'&&JSON.parse(r.inputJson).partId===partId));
      const state=await (await fetch(origin+'/api/agent/state?conversationId='+conv.id)).json();assert.equal(state.visualToolsAvailable,true);
      const stored=await db.conversation.findUniqueOrThrow({where:{id:conv.id}});
      if(backend==='codex'){threads.add(stored.codexThreadId);if(thread)assert.equal(stored.codexThreadId,thread);thread=stored.codexThreadId;assert.equal(JSON.parse((await db.setting.findUniqueOrThrow({where:{key:'codex.tools.'+conv.id}})).value).version,3);}
      rounds.push({taskMode,kind,resumed:kind!=='pdf',nativeImage:true,citations:true,actualVisualRecognition:!synthetic});console.log(JSON.stringify(rounds.at(-1)));
    }
    assert.equal(await db.attachment.count({where:{message:{conversationId:conv.id}}}),3,'Read tools created or overwrote attachments');
  }
  return rounds;
}
