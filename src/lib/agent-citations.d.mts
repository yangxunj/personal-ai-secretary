export type AgentSource={kind?:'attachment';attachmentId:string;filename:string;locator:string;url:string;version:string;representation?:import('./attachment-access').Representation}
  |{kind:'record';sourceKind:import('./agent-text').RecordKind;recordId:string;version:string;filename:string;locator:string;url:string}
  |{kind:'web';token:string;filename:string;locator:string;url:string};
export function sourceKey(source:AgentSource):string;
export class CitationStream {
  text:string;used:AgentSource[];sources:Map<string,AgentSource>;
  register(token:string,source:AgentSource):void;
  push(delta:string,finish?:boolean):string;
  appendix():string;
}
