export type AgentSource={kind?:'attachment';attachmentId:string;filename:string;locator:string;url:string;version:string}
  |{kind:'web';token:string;filename:string;locator:string;url:string};
export class CitationStream {
  text:string;used:AgentSource[];sources:Map<string,AgentSource>;
  register(token:string,source:AgentSource):void;
  push(delta:string,finish?:boolean):string;
  appendix():string;
}
