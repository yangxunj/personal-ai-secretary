import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { randomInt } from 'node:crypto';

export function picture(marker){
  const canvas=createCanvas(700,360),c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,700,360);
  c.fillStyle='#163758';c.font='bold 34px Arial';c.fillText('Synthetic evidence',35,55);
  c.strokeStyle='#555';c.lineWidth=2;c.strokeRect(30,95,640,200);c.beginPath();c.moveTo(30,195);c.lineTo(670,195);c.moveTo(210,95);c.lineTo(210,295);c.stroke();
  c.font='26px Arial';c.fillText('Code',50,155);c.fillText(marker,230,155);c.fillText('Value',50,255);c.fillText('72.5',230,255);
  return {png:canvas.toBuffer('image/png'),jpeg:canvas.toBuffer('image/jpeg')};
}
export function scanPdf(marker,rotation=0){
  const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Count 8 /Kids ['+Array.from({length:8},(_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>')];
  for(let i=0;i<8;i++){
    const id=3+i*3,jpeg=picture(i===7?marker:'PAGE '+(i+1)).jpeg,content=Buffer.from('q 700 0 0 360 0 0 cm /Im Do Q');
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 360] /Rotate ${rotation} /Resources << /XObject << /Im ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`));
    objects.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 700 /Height 360 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]));
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`),content,Buffer.from('\nendstream')]));
  }
  const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let length=chunks[0].length;
  for(const [i,object]of objects.entries()){offsets.push(length);const bytes=Buffer.concat([Buffer.from((i+1)+' 0 obj\n'),object,Buffer.from('\nendobj\n')]);chunks.push(bytes);length+=bytes.length;}
  chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));return Buffer.concat(chunks);
}
export async function richWord(marker){
  const zip=new JSZip(),w='http://schemas.openxmlformats.org/wordprocessingml/2006/main',r='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const types={document:'document.main',header1:'header',footer1:'footer',comments:'comments',footnotes:'footnotes',endnotes:'endnotes'};
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/>'+Object.entries(types).map(([part,type])=>`<Override PartName="/word/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join('')+'</Types>');
  zip.file('_rels/.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`);
  const drawing=(external=false)=>`<w:drawing><wp:inline><wp:extent cx="5334000" cy="2743200"/><wp:docPr id="${external?2:1}" name="Evidence"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip ${external?'r:link="external"':'r:embed="img1"'}/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5334000" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  zip.file('word/document.xml',`<w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>Original requirement</w:t></w:r><w:del w:id="1" w:author="Editor"><w:r><w:delText>Deleted text</w:delText></w:r></w:del><w:ins w:id="2" w:author="Editor"><w:r><w:t>Inserted text</w:t></w:r></w:ins><w:r><w:commentReference w:id="4"/><w:footnoteReference w:id="7"/><w:endnoteReference w:id="8"/></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell-A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell-B</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r>${drawing()}${drawing(true)}</w:r></w:p><w:p><w:r><w:t>${'Long structured original. '.repeat(400)}</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="img1" Type="${r}/image" Target="media/image1.png"/><Relationship Id="external" Type="${r}/image" Target="https://example.invalid/private.png" TargetMode="External"/><Relationship Id="header" Type="${r}/header" Target="header1.xml"/><Relationship Id="footer" Type="${r}/footer" Target="footer1.xml"/>`+['comments','footnotes','endnotes'].map(p=>`<Relationship Id="${p}" Type="${r}/${p}" Target="${p}.xml"/>`).join('')+'</Relationships>');
  for(const [name,tag,text,attributes]of [['header1','hdr','HEADER-MARK',''],['footer1','ftr','FOOTER-MARK',''],['comments','comments','COMMENT-MARK',''],['footnotes','footnotes','FOOTNOTE-MARK',''],['endnotes','endnotes','ENDNOTE-MARK','']]){
    let content=`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
    if(name==='comments')content=`<w:comment w:id="4" w:author="Reviewer">${content}</w:comment>`;
    if(name==='footnotes')content=`<w:footnote w:id="7">${content}</w:footnote>`;
    if(name==='endnotes')content=`<w:endnote w:id="8">${content}</w:endnote>`;
    zip.file('word/'+name+'.xml',`<w:${tag} xmlns:w="${w}" ${attributes}>${content}</w:${tag}>`);
  }
  zip.file('word/media/image1.png',picture(marker).png);zip.file('word/media/unreferenced.png',picture('UNREFERENCED').png);
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
export async function mediaFixtures(){
  const markers={image:'IMG-'+randomInt(100000,999999),scan:'SCAN-'+randomInt(100000,999999),word:'WORD-'+randomInt(100000,999999)};
  return {markers,image:picture(markers.image).png,pdf:scanPdf(markers.scan),docx:await richWord(markers.word)};
}
