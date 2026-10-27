import { readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { UPLOAD_DIR } from '@/lib/storage';

export const attachmentScope=(conversationId:string,taskId:string|null)=>taskId?{OR:[{taskId},{message:{conversationId}}]}:{};
export async function attachmentBytes(storedPath:string) {
  const original=path.resolve(UPLOAD_DIR,storedPath);
  if((await lstat(original)).isSymbolicLink())throw new Error('Linked attachment denied');
  const base=await realpath(UPLOAD_DIR),file=await realpath(original),rel=path.relative(base,file);
  if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Attachment path denied');
  const stat=await lstat(file);if(!stat.isFile()||stat.nlink!==1||stat.size>25*1024*1024)throw new Error('Attachment type or size denied');
  const bytes=await readFile(file);if(bytes.length>25*1024*1024)throw new Error('Attachment size denied');return bytes;
}
export type Representation='text-v2'|'rich-v1';
export const attachmentVersion=(bytes:Uint8Array,representation:Representation='text-v2')=>createHash('sha256').update('attachment-'+representation+'\n').update(bytes).digest('hex');
export async function loadAttachment(id:string,conversationId:string,taskId:string|null){
  const attachment=await db.attachment.findFirst({where:{id,...attachmentScope(conversationId,taskId)}});
  if(!attachment)throw new Error('Attachment is outside this conversation/task scope or no longer exists');
  return {attachment,bytes:await attachmentBytes(attachment.storedPath)};
}
