export type Crop={x:number;y:number;width:number;height:number};
export type ToolImage={mimeType:'image/png';data:string;width:number;height:number};
export class RenderUnavailable extends Error{}
export async function visualSupport(){
  const [raster,pdf]=await Promise.allSettled([import('sharp'),import('@napi-rs/canvas')]);
  return {rasterAvailable:raster.status==='fulfilled',pdfRendererAvailable:raster.status==='fulfilled'&&pdf.status==='fulfilled'};
}
async function imageEngine(){try{return (await import('sharp')).default;}catch{throw new RenderUnavailable('Image processor is unavailable on this installation. Text readers remain available.');}}
export async function rasterImage(bytes:Uint8Array,crop?:Crop):Promise<ToolImage>{
  const sharp=await imageEngine();
  const source=sharp(bytes,{limitInputPixels:20_000_000,animated:false});
  const info=await source.metadata();
  if(!['png','jpeg','webp','gif'].includes(info.format||''))throw new Error('Unsupported raster format; use PNG/JPEG/WebP/static GIF');
  if((info.pages||1)>1)throw new Error('Animated/multipage image is not supported; export a single frame');
  const normalized=await source.rotate().resize({width:2200,height:2200,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  let pipeline=sharp(normalized.data);
  if(crop){
    const {width,height}=normalized.info,left=Math.floor(crop.x*width),top=Math.floor(crop.y*height);
    const right=Math.min(width,Math.ceil((crop.x+crop.width)*width)),bottom=Math.min(height,Math.ceil((crop.y+crop.height)*height));
    pipeline=pipeline.extract({left,top,width:right-left,height:bottom-top});
  }
  const result=await pipeline.png().toBuffer({resolveWithObject:true});if(result.data.length>2*1024*1024)throw new Error('Rendered image exceeds 2 MiB; request a smaller crop');
  return {mimeType:'image/png',data:result.data.toString('base64'),width:result.info.width,height:result.info.height};
}
export async function withPdf<T>(bytes:Uint8Array,read:(pdf:any)=>Promise<T>){
  const {getDocumentProxy}=await import('unpdf'),pdf=await getDocumentProxy(new Uint8Array(bytes),{maxImageSize:20_000_000,canvasMaxAreaInBytes:32*1024*1024});
  try{if(pdf.numPages>1000)throw new Error('PDF page count exceeds limit (1000)');return await read(pdf);}finally{await pdf.loadingTask.destroy();}
}
export async function pdfImage(bytes:Uint8Array,page:number,crop?:Crop){
  return withPdf(bytes,async pdf=>{
    if(page>pdf.numPages)throw new Error('PDF page out of range');
    const p=await pdf.getPage(page),view=p.getViewport({scale:1});
    if(!Number.isFinite(view.width)||!Number.isFinite(view.height)||view.width<=0||view.height<=0)throw new Error('Invalid PDF page dimensions');
    const region=crop||{x:0,y:0,width:1,height:1},scale=Math.min(crop?4:2,2200/Math.max(view.width*region.width,view.height*region.height));
    let canvas;try{canvas=await import('@napi-rs/canvas');}catch{throw new RenderUnavailable('PDF renderer is unavailable on this installation. Use readAttachment/readDocumentPart for existing text; scanned pages require a supported renderer.');}
    const {createIsomorphicCanvasFactory}=await import('unpdf'),Factory=await createIsomorphicCanvasFactory(async()=>canvas),factory:any=new Factory();
    const viewport=p.getViewport({scale}),drawing=factory.create(Math.max(1,Math.ceil(viewport.width*region.width)),Math.max(1,Math.ceil(viewport.height*region.height)));
    try{
      await p.render({canvas:drawing.canvas,canvasContext:drawing.context,viewport,transform:[1,0,0,1,-viewport.width*region.x,-viewport.height*region.y]}).promise;
      const png=await drawing.canvas.encode('png');
      return {image:await rasterImage(png),totalPages:pdf.numPages,note:'PDF page rendered with rotation and crop applied. Embedded images above 20 million pixels may be omitted by PDF.js; disclose missing visual content rather than treating a blank region as evidence.'};
    }finally{factory.destroy(drawing);}
  });
}
export async function pdfLayout(bytes:Uint8Array,page:number){
  return withPdf(bytes,async pdf=>{
    if(page<1||page>pdf.numPages)throw new Error('PDF page out of range');
    const p=await pdf.getPage(page),viewport=p.getViewport({scale:1}),content=await p.getTextContent();
    let length=0;const lines:string[]=[];
    for(const item of content.items){if(!('str' in item))continue;const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
      const line=JSON.stringify({x:Math.round(x*10)/10,y:Math.round(y*10)/10,width:item.width,height:item.height,text:item.str});length+=line.length;if(length>2_000_000)throw new Error('PDF page layout exceeds size limit');lines.push(line);}
    return {text:lines.join('\n'),width:viewport.width,height:viewport.height,totalPages:pdf.numPages,note:'PDF text items with top-left page coordinates at 72dpi. Reading order and table cells are not inferred. Inspect the page image/crop for tables, charts or scanned text. No text items means this page requires visual reading.'};
  });
}
