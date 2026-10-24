import type { AgentSession, SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent';
export type PiSource={attachmentId:string;filename:string;locator:string;url:string;version:string};
export function configFingerprint(cfg:{baseUrl:string;model:string}):string;
export function openPiSession(options:{directory:string;cfg:{baseUrl:string;apiKey:string;model:string;seesImages?:boolean};instructions:string;tools:ToolDefinition[];contextWindow?:number;history?:string[];fetchImpl?:typeof fetch}):Promise<{
  session:AgentSession;manager:SessionManager;manifest:{fingerprint:string;sessionFile:string;importedMessages:number;pendingTurn?:string|null};saveManifest:(patch:Record<string,unknown>)=>Promise<void>;readonly requests:number;
}>;
export class CitationStream {
  text:string;used:PiSource[];sources:Map<string,PiSource>;
  register(token:string,source:PiSource):void;
  push(delta:string,finish?:boolean):string;
  appendix():string;
}
