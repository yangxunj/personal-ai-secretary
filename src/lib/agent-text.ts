import { createHash } from 'node:crypto';
export type RecordKind='taskDetail'|'taskResult'|'document'|'topic'|'taskMessage'|'historyMessage';
export const recordVersion=(kind:RecordKind,id:string,title:string,text:string)=>createHash('sha256').update(JSON.stringify(['record-text-v1',kind,id,title,text])).digest('hex');
export const recordDescriptor=(kind:RecordKind,id:string,title:string,text:string)=>({kind,id,version:recordVersion(kind,id,title,text),totalCharacters:text.length});
export function textPage(text:string,offset:number,expectedVersion:string|undefined,version:string){
  if(offset>0&&!expectedVersion)throw new Error('Continuation requires expectedVersion from the first read.');
  if(expectedVersion&&expectedVersion!==version)throw new Error('Source version changed; read again from offset 0.');
  if(offset>text.length)throw new Error('Text offset out of range');
  if(offset&&/[\uDC00-\uDFFF]/.test(text[offset]||'')&&/[\uD800-\uDBFF]/.test(text[offset-1]))throw new Error('Use the returned nextOffset for continuation');
  let end=Math.min(text.length,offset+6000);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
  return {text:text.slice(offset,end),version,totalCharacters:text.length,nextOffset:end<text.length?end:null};
}
