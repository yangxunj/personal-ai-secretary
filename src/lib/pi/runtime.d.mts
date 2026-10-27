import type { AgentSession, SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent';
export type {AgentSource as PiSource} from '../agent-citations.mjs';
export {CitationStream} from '../agent-citations.mjs';
export function configFingerprint(cfg:{baseUrl:string;model:string}):string;
export function openPiSession(options:{directory:string;cfg:{baseUrl:string;apiKey:string;model:string;seesImages?:boolean};instructions:string;tools:ToolDefinition[];contextWindow?:number;history?:string[];fetchImpl?:typeof fetch}):Promise<{
  session:AgentSession;manager:SessionManager;manifest:{fingerprint:string;sessionFile:string;importedMessages:number;pendingTurn?:string|null};saveManifest:(patch:Record<string,unknown>)=>Promise<void>;readonly requests:number;
}>;
