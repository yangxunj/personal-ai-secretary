// Hide internal citation tokens even when they are split across streamed deltas.
export class CitationStream {
  constructor(){this.buffer='';this.sources=new Map();this.used=[];this.text='';}
  register(token,source){this.sources.set(token,source);}
  push(delta,finish=false){
    this.buffer+=delta;let output='';const prefix='[[cite:';
    while(this.buffer){
      const at=this.buffer.indexOf(prefix);
      if(at===-1){let keep=0;if(!finish)for(let n=1;n<prefix.length;n++)if(this.buffer.endsWith(prefix.slice(0,n)))keep=n;
        output+=this.buffer.slice(0,this.buffer.length-keep);this.buffer=this.buffer.slice(this.buffer.length-keep);break;}
      output+=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at);
      const end=this.buffer.indexOf(']]');if(end===-1){if(finish||this.buffer.length>256){output+='（来源未核实）';this.buffer='';}break;}
      const token=this.buffer.slice(prefix.length,end),source=this.sources.get(token);
      if(source){let number=this.used.findIndex(s=>source.kind==='web'?s.kind==='web'&&s.url===source.url&&s.locator===source.locator:s.kind!=='web'&&s.attachmentId===source.attachmentId&&s.locator===source.locator)+1;
        if(!number){this.used.push(source);number=this.used.length;}output+=`[〔${number}〕](${source.url})`;
      }else output+='（来源未核实）';
      this.buffer=this.buffer.slice(end+2);
    }
    this.text+=output;return output;
  }
  appendix(){return this.used.length?'\n\n'+this.used.map((s,i)=>`〔${i+1}〕[${String(s.filename).replace(/[\[\]\\\r\n<>]/g,'')} · ${s.locator}](${s.url})`).join('\n\n'):'';}
}
