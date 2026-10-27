import path from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

type ImageRef={id:string;part:string;relationship:string};
export type WordStructure={parts:{id:string;kind:string;text:string}[];images:ImageRef[];note:string};
const W=new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main']);
const R=['http://schemas.openxmlformats.org/officeDocument/2006/relationships','http://purl.oclc.org/ooxml/officeDocument/relationships'];
type XmlNode=ReturnType<DOMParser['parseFromString']>;
export async function openWord(bytes:Uint8Array){
  const zip=await JSZip.loadAsync(bytes),names=Object.keys(zip.files);
  if(names.length>1000)throw new Error('DOCX exceeds entry limit (1000)');
  if(names.some(n=>n.length>200))throw new Error('DOCX entry name exceeds size limit');return zip;
}
export async function wordEntry(zip:JSZip,id:string,maxBytes:number){
  const entry=zip.file(id);if(!entry)throw new Error('DOCX part not found');
  // Stream decompression, stopping before a compressed bomb can allocate the complete output.
  return new Promise<Buffer>((resolve,reject)=>{
    const chunks:Buffer[]=[];let length=0,failed=false;
    // JSZip's runtime exposes this streaming API; its bundled declaration omits it.
    const stream=(entry as typeof entry & {internalStream(type:'uint8array'):JSZip.JSZipStreamHelper<Uint8Array>}).internalStream('uint8array');
    stream.on('data',chunk=>{if(failed)return;length+=chunk.length;if(length>maxBytes){failed=true;stream.pause();reject(new Error('DOCX part exceeds decompressed size limit'));return;}chunks.push(Buffer.from(chunk));})
      .on('error',reject).on('end',()=>{if(!failed)resolve(Buffer.concat(chunks));}).resume();
  });
}
function xml(bytes:Buffer):XmlNode{
  const text=bytes.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(text)||(text.match(/</g)||[]).length>100000)throw new Error('Unsupported or excessive DOCX XML');
  let invalid=false;
  const parsed=new DOMParser({errorHandler:{warning:()=>{invalid=true;},error:()=>{invalid=true;},fatalError:()=>{invalid=true;}}}).parseFromString(text,'text/xml');
  if(invalid||!parsed.documentElement)throw new Error('Malformed DOCX XML');return parsed;
}
function attr(node:any,name:string){for(const ns of W){const value=node.getAttributeNS?.(ns,name);if(value)return value;}return node.getAttribute?.(name)||'';}
function relAttr(node:any,name:string){for(const ns of R){const value=node.getAttributeNS?.(ns,name);if(value)return value;}return '';}
export async function wordStructure(bytes:Uint8Array):Promise<WordStructure>{
  const zip=await openWord(bytes),parts:WordStructure['parts']=[],images:ImageRef[]=[],seenImages=new Set<string>();let aggregate=0;
  const names=Object.keys(zip.files).filter(n=>/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n)).sort();
  if(!names.includes('word/document.xml'))throw new Error('DOCX main document missing');
  if(names.some(n=>n.length>150))throw new Error('DOCX part ID exceeds size limit');
  for(const id of names){
    const data=await wordEntry(zip,id,4*1024*1024);aggregate+=data.length;if(aggregate>16*1024*1024)throw new Error('DOCX XML total exceeds size limit');
    const document=xml(data);if(!W.has(document.documentElement.namespaceURI||''))throw new Error('Unsupported DOCX namespace');
    const rels=new Map<string,{target:string;external:boolean}>(),relFile=path.posix.join(path.posix.dirname(id),'_rels',path.posix.basename(id)+'.rels');
    if(zip.file(relFile)){
      const relData=await wordEntry(zip,relFile,1024*1024);aggregate+=relData.length;
      if(aggregate>16*1024*1024)throw new Error('DOCX XML total exceeds size limit');
      const nodes=xml(relData).getElementsByTagNameNS('*','Relationship');
      for(let i=0;i<nodes.length;i++){const n=nodes[i],target=n.getAttribute('Target')||'',rid=n.getAttribute('Id')||'';
        if(rid.length>100||target.length>1000)throw new Error('DOCX relationship exceeds size limit');rels.set(rid,{target,external:n.getAttribute('TargetMode')==='External'});}
    }
    const chunks:string[]=[];let length=0,paragraph=0,table=0,nodes=0;
    const add=(s:string)=>{length+=s.length;if(length>2_000_000)throw new Error('DOCX structured text exceeds size limit');chunks.push(s);};
    const visit=(node:any,depth:number)=>{
      if(depth>128||++nodes>100000)throw new Error('DOCX structure exceeds complexity limit');
      if(node.nodeType!==1)return;
      const name=node.localName,isWord=W.has(node.namespaceURI),relation=relAttr(node,'embed')||relAttr(node,'link')||(name==='imagedata'?relAttr(node,'id'):'');
      if((name==='blip'||name==='imagedata'&&node.namespaceURI==='urn:schemas-microsoft-com:vml')&&relation){
        const ref=rels.get(relation),target=ref&&!ref.external?path.posix.normalize(path.posix.join(path.posix.dirname(id),ref.target)):null;
        if(target&&target.startsWith('word/media/')&&zip.file(target)){
          const key=id+'\n'+target;if(!seenImages.has(key)){seenImages.add(key);if(images.length>=1000)throw new Error('DOCX image reference count exceeds limit');images.push({id:target,part:id,relationship:relation});}add('[image '+target+']');
        }else add('[external or unavailable image '+relation+'; not fetched]');
        return;
      }
      if(isWord){
        if(name==='t'||name==='delText'){add(node.textContent||'');return;}
        if(name==='instrText'){add('[field instruction: '+(node.textContent||'')+']');return;}
        if(name==='tab'){add('\t');return;}if(name==='br'||name==='cr'){add('\n');return;}
        if(name==='p')add('\n[paragraph '+(++paragraph)+'] ');
        if(name==='tbl')add('\n[table '+(++table)+']\n');if(name==='tr')add('\n[row] ');if(name==='tc')add('[cell] ');
        if(['ins','del','moveFrom','moveTo'].includes(name))add('['+name+' id='+attr(node,'id')+' author='+attr(node,'author')+' date='+attr(node,'date')+']');
        if(['comment','footnote','endnote'].includes(name))add('\n['+name+' id='+attr(node,'id')+' author='+attr(node,'author')+']\n');
        if(['commentReference','commentRangeStart','commentRangeEnd','footnoteReference','endnoteReference'].includes(name))add('['+name+' id='+attr(node,'id')+']');
        if(['headerReference','footerReference','hyperlink'].includes(name)){const rid=relAttr(node,'id'),ref=rels.get(rid);add('['+name+' '+rid+' target='+(ref?.target||'')+']');}
        if(name==='gridSpan'||name==='vMerge')add('['+name+' '+attr(node,'val')+']');
        if(['rPrChange','pPrChange','tblPrChange','tcPrChange','sectPrChange','cellIns','cellDel','cellMerge'].includes(name))add('[format/table revision '+name+' id='+attr(node,'id')+' author='+attr(node,'author')+'; formatting not reconstructed]');
        if(name==='altChunk')add('[unsupported embedded altChunk]');
      }
      for(let child=node.firstChild;child;child=child.nextSibling)visit(child,depth+1);
      if(isWord&&['ins','del','moveFrom','moveTo','hyperlink'].includes(name))add('[/'+name+']');
    };
    visit(document.documentElement,0);
    parts.push({id,kind:path.posix.basename(id,'.xml').replace(/\d+$/,''),text:chunks.join('').trim()});
  }
  return {parts,images,note:'OOXML structure, not Word page layout. Paragraph/table/cell locations are local to each part. Insertions, deletions, moves, comment references and note IDs are labelled, not accepted or executed. Only embedded raster images referenced by these parts can be read. External images are never fetched. Unsupported embedded objects/charts/altChunk and exact pagination may require an exported PDF.'};
}
export async function wordImage(bytes:Uint8Array,id:string){
  const structure=await wordStructure(bytes);if(!structure.images.some(i=>i.id===id))throw new Error('DOCX image outside referenced media scope');
  return wordEntry(await openWord(bytes),id,10*1024*1024);
}
