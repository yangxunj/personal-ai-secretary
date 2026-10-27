import { EventEmitter } from 'node:events';
export function resolveExecutable(explicit?: string): string;
export class CodexConnection extends EventEmitter {
  constructor(options?: {executable?: string;cwd?: string;launcher?: (args:string[]) => unknown;webSearch?:'disabled'|'live'});
  connect(): Promise<void>;
  request(method: string, params?: Record<string, unknown>): Promise<any>;
  send(message: unknown): void;
  respond(id: number | string, result: unknown): void;
  close(): void;
}
export function denyRequest(client: CodexConnection, message: any): void;
export function runTurn(client: CodexConnection, options: {threadId: string;input: unknown[];effort?: string;onEvent?: (msg: any) => void;onStarted?: (id: string) => void | Promise<void>;timeoutMs?: number}): Promise<string>;
