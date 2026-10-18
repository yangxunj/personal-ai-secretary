export type MailFinding = { id: string; summary: string; action: string; evidence: string; sourceUrl?: string; dueDate?: string | null; status?: string; notified?: boolean; taskId?: string; [key: string]: any };
export type MailState = { version: number; account: string; cursor: number; seen: string[]; findings: MailFinding[]; enabled: boolean; analysisApproved: boolean; analysisTarget: string; intervalMinutes: number; notifications: boolean; [key: string]: any };
export class MailStore {
  constructor(root: string);
  read(): Promise<MailState | null>;
  write(state: MailState): Promise<void>;
  clear(): Promise<void>;
  update(fn: (state: MailState | null) => MailState | null | Promise<MailState | null>): Promise<MailState | null>;
}
export function initialMailState(account: string, now?: number): MailState;
