import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

// A dedicated app-private ledger; no email bodies, credentials or model keys.
export class MailStore {
  constructor(root) { this.root = root; this.tail = Promise.resolve(); }
  async read() {
    try {
      const state = JSON.parse(await readFile(path.join(this.root, 'state.json'), 'utf8'));
      if (state.version !== 1 || typeof state.account !== 'string' || !Number.isFinite(state.cursor) || !Array.isArray(state.seen) || !Array.isArray(state.findings)) throw new Error('MAIL_STATE_INVALID');
      return state;
    } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('MAIL_STATE_INVALID'); }
  }
  async write(state) {
    await mkdir(this.root, { recursive: true });
    const file = path.join(this.root, 'state.json');
    await writeFile(file + '.tmp', JSON.stringify(state), { mode: 0o600 });
    await rename(file + '.tmp', file);
  }
  update(fn) {
    const work = this.tail.catch(() => {}).then(async () => {
      const next = await fn(await this.read());
      if (next) await this.write(next);
      return next;
    });
    this.tail = work; return work;
  }
  clear() {
    // Queue deletion behind existing mutations, without reading a possibly damaged ledger.
    const work = this.tail.catch(() => {}).then(async () => {
      for (const name of ['state.json', 'state.json.tmp']) await unlink(path.join(this.root, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    });
    this.tail = work; return work;
  }
}
export function initialMailState(account, now = Date.now()) {
  if (typeof account !== 'string' || account.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) throw new Error('MAIL_ACCOUNT_INVALID');
  return { version: 1, account, cursor: Math.floor(now / 1000) - 7 * 86400, seen: [], findings: [], totalAnalyzed: 0,
    enabled: false, analysisApproved: false, analysisTarget: '', intervalMinutes: 60, notifications: false, lastSuccessAt: null, lastError: null };
}
