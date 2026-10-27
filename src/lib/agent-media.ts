import { randomUUID } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import { loadAttachment, attachmentVersion } from '@/lib/attachment-access';
import { cachedAttachment } from '@/lib/attachment-cache';
import { wordStructure, wordImage } from '@/lib/docx-structure';
import { pdfImage, pdfLayout, rasterImage, withPdf, visualSupport, RenderUnavailable, type ToolImage } from '@/lib/attachment-visual';
import { externalRead } from '@/lib/agent-tool-policy';
import { textPage } from '@/lib/agent-text';
import { docKind } from '@/lib/doc-extract';

const idSchema={attachmentId:z.string().min(1).max(100),expectedVersion:z.string().regex(/^[a-f0-9]{64}$/).optional()};
const cropSchema=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().gt(0).max(1),height:z.number().gt(0).max(1)}).refine(c=>c.x+c.width<=1&&c.y+c.height<=1,'Crop must be inside the image');
export const PLATFORM_MEDIA_GUIDE='Rich attachment tools are available: inspectAttachment lists DOCX parts and referenced embedded images, PDF page count, and rendering limits. readDocumentPart reads labelled Word paragraphs/tables, insertions/deletions/moves, comments, headers/footers and notes, or PDF page:N positioned text. This is structure, not exact Word page layout. readAttachmentVisual returns an actual image block for an archived image, selected PDF page, or referenced DOCX image. Crop is normalized top-left x/y/width/height after rotation. Never infer complete tables from plain text or claim to see an image when ok=false. Carry inspectAttachment version when reading parts/images; continuations need expectedVersion. All rich tools use one rich-v1 version, different from readAttachment text version. Citations open the original source (PDF page where applicable); Word part/image/crop location is in the source label. External resources/macros/fields are not executed. Use readAttachment for legacy text and formats not supported by rich tools.';

export function buildAgentMediaTools(conversationId:string,taskId:string|null,{seesImages=true}:{seesImages?:boolean}={}){
  let images=0;
  const load=async(id:string,expected?:string)=>{
    const result=await loadAttachment(id,conversationId,taskId),version=attachmentVersion(result.bytes,'rich-v1');
    if(expected&&expected!==version)throw new Error('Attachment version changed; inspect the source again');
    return {...result,version,kind:docKind(result.attachment.mimeType,result.attachment.filename)};
  };
  const citation=(a:{id:string;filename:string},version:string,locator:string,page?:number)=>({token:randomUUID(),attachmentId:a.id,filename:a.filename,locator,url:'/api/files/'+a.id+(page?'#page='+page:''),version,representation:'rich-v1'});
  return {
    inspectAttachment:externalRead(tool({description:'Inspect archived DOCX structure (parts and referenced embedded images), PDF page count, or image capability. Metadata only. DOCX parts are not rendered Word pages. Continue metadata with offset and expectedVersion. Does not follow external relationships.',inputSchema:z.object({...idSchema,offset:z.number().int().min(0).default(0)}),execute:async({attachmentId,expectedVersion,offset})=>{
      if(offset>0&&!expectedVersion)throw new Error('Continuation requires expectedVersion');
      const {attachment,bytes,version,kind}=await load(attachmentId,expectedVersion);
      const capabilities={seesImages,...await visualSupport(),maxImageEdge:2200,maxImageBytes:2*1024*1024,maxImagesPerTurn:6};
      if(kind==='docx'){
        const doc=await cachedAttachment(version+':structure',()=>wordStructure(bytes));
        const entries=[...doc.parts.map(p=>({kind:p.kind,partId:p.id,totalCharacters:p.text.length,preview:p.text.slice(0,200)})),...doc.images.map(i=>({kind:'image',imageId:i.id,partId:i.part,relationship:i.relationship}))];
        if(offset>entries.length)throw new Error('Structure offset out of range');
        return {ok:true,version,entries:entries.slice(offset,offset+20),total:entries.length,nextOffset:offset+20<entries.length?offset+20:null,note:doc.note,capabilities};
      }
      if(kind==='pdf')return withPdf(bytes,async pdf=>({ok:true,version,totalPages:pdf.numPages,partIdFormat:'page:N',nextOffset:null,capabilities,note:'Use readDocumentPart for positioned text; readAttachmentVisual for a selected page or crop. Scanned pages have no reliable text layer.'}));
      return {ok:true,version,nextOffset:null,capabilities,note:'Visual reader supports PNG/JPEG/WebP/static GIF. Other files use readAttachment when supported.'};
    }})),
    readDocumentPart:externalRead(tool({description:'Read complete versioned text from a DOCX XML part ID returned by inspectAttachment, including labelled structure/comments/revisions/headers/notes, or PDF partId=page:N with text positions. Up to 6000 characters; follow nextOffset with expectedVersion. PDF positions assist layout inspection, not guaranteed table cells.',inputSchema:z.object({...idSchema,partId:z.string().min(1).max(150),offset:z.number().int().min(0).default(0)}),execute:async({attachmentId,expectedVersion,partId,offset})=>{
      const {attachment,bytes,version,kind}=await load(attachmentId,expectedVersion);let text='',note='',page:number|undefined;
      if(kind==='docx'){const doc=await cachedAttachment(version+':structure',()=>wordStructure(bytes)),part=doc.parts.find(p=>p.id===partId);if(!part)throw new Error('DOCX part outside readable scope');text=part.text;note=doc.note;}
      else if(kind==='pdf'&&/^page:[1-9]\d{0,3}$/.test(partId)){page=Number(partId.slice(5));const layout=await cachedAttachment(version+':layout:'+page,()=>pdfLayout(bytes,page!));text=layout.text;note=layout.note;}
      else throw new Error('Structured reader supports DOCX parts and PDF page:N');
      return {ok:true,...textPage(text,offset,expectedVersion,version),partId,note,citation:citation(attachment,version,partId+' · text '+(offset+1),page)};
    }})),
    readAttachmentVisual:externalRead(tool({description:'Read a real image from an archived raster image, selected PDF page, or DOCX imageId from inspectAttachment. Optional normalized top-left crop x/y/width/height. Pass the rich tool version when known. Returns a real model image block, not base64 text. Maximum 6 images/turn, 2200px edge, 2MiB output; no external images. Text-only models receive an explicit unsupported result.',inputSchema:z.object({...idSchema,page:z.number().int().min(1).max(1000).default(1),imageId:z.string().max(200).optional(),crop:cropSchema.optional()}),execute:async({attachmentId,expectedVersion,page,imageId,crop})=>{
      const {attachment,bytes,version,kind}=await load(attachmentId,expectedVersion);
      if(!seesImages)return {ok:false,version,code:'model_has_no_vision',note:'The selected model does not support images. Use text/structure tools, or select an image-capable model. Scanned text cannot be read by this model.'};
      if(images>=6)throw new Error('Visual tool budget exceeded (6 images per turn)');images++;
      try{
        const rendered=await cachedAttachment(version+':visual:'+kind+':'+JSON.stringify({page,imageId,crop}),async()=>{
          if(kind==='pdf'){if(imageId)throw new Error('PDF does not accept imageId');return pdfImage(bytes,page,crop);}
          if(page!==1)throw new Error('Only PDFs support page selection');
          const input=kind==='docx'?(imageId?await wordImage(bytes,imageId):null):bytes;
          if(!input)throw new Error('Select a referenced DOCX imageId with inspectAttachment');
          if(kind&&kind!=='docx')throw new Error('Visual reader does not support this document format');
          if(kind!=='docx'&&imageId)throw new Error('Only DOCX supports imageId');
          return {image:await rasterImage(input,crop),totalPages:null};
        });
        const locator=(kind==='pdf'?'PDF page '+page:kind==='docx'?'DOCX image '+imageId:'Image')+(crop?' · crop '+JSON.stringify(crop):' · full image');
        return {ok:true,version,...rendered,locator,citation:citation(attachment,version,locator,kind==='pdf'?page:undefined)};
      }catch(e){if(e instanceof RenderUnavailable)return {ok:false,version,code:'renderer_unavailable',note:e.message};throw e;}
    }})),
  };
}

// Keep base64 out of UI deltas and textual tool messages. SQL receipts and the
// native harness session retain the bounded image for deterministic tool replay.
const hasImage=(result:any)=>result?.ok===true&&result.image?.mimeType==='image/png'&&typeof result.image.data==='string';
export function visibleMediaResult(result:any){if(!hasImage(result))return result;const {image,...rest}=result;return {...rest,image:{mimeType:image.mimeType,width:image.width,height:image.height,bytes:Buffer.byteLength(image.data,'base64')}};}
export function piToolContent(result:any):({type:'text';text:string}|({type:'image'}&ToolImage))[]{return [{type:'text',text:JSON.stringify(visibleMediaResult(result)??null)},...(hasImage(result)?[{type:'image' as const,...result.image}]:[])];}
export function codexToolContent(result:any){return [{type:'inputText',text:JSON.stringify(visibleMediaResult(result)??null)},...(hasImage(result)?[{type:'inputImage',imageUrl:'data:'+result.image.mimeType+';base64,'+result.image.data}]:[])];}
