import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { codexArguments } from './web-search.mjs';

// Resolve an installed CLI or desktop executable; never run a string through a shell.
export function resolveExecutable(explicit = '') {
  const directories = (process.env.PATH || '').split(path.delimiter);
  const candidates = explicit ? [explicit] : directories.flatMap(p => process.platform === 'win32' ? [path.join(p, 'codex.exe')] : [path.join(p, 'codex')]);
  if (!explicit && process.platform === 'win32') {
    const roots = [path.join(process.env.LOCALAPPDATA || '', 'OpenAI/Codex/bin'), path.join(os.homedir(), '.codex/packages/app-server-daemon/releases')];
    for (const root of roots) {
      candidates.push(path.join(root, 'codex.exe'));
      try {
        const dirs = readdirSync(root).map(n => path.join(root, n)).sort((a,b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
        for (const dir of dirs) candidates.push(path.join(dir, 'codex.exe'), path.join(dir, 'bin/codex.exe'));
      } catch { /* installation may be absent */ }
    }
  }
  const found = candidates.find(p => existsSync(p) && statSync(p).isFile() && (process.platform === 'win32' ? /\.exe$/i.test(p) : !/\.(cmd|bat|ps1)$/i.test(p)));
  if (!found) throw new Error('Codex executable not found. Install Codex or set the full executable path in Settings (use codex.exe, not a .cmd shim).');
  return path.resolve(found);
}

export class CodexConnection extends EventEmitter {
  constructor({ executable, cwd, launcher, webSearch='disabled' } = {}) {
    super(); this.args=codexArguments(webSearch);this.executable = executable; this.cwd = cwd; this.launcher = launcher; this.pending = new Map(); this.seq = 0; this.closed = false;
  }
  async connect() {
    this.proc = this.launcher ? this.launcher(this.args) : spawn(resolveExecutable(this.executable), this.args, { cwd: this.cwd, stdio: ['pipe','pipe','pipe'], windowsHide: true });
    this.proc.on('error', e => this.fail(e));
    this.proc.on('exit', () => this.fail(new Error('Codex process exited. Check installation, version and login; this turn will not be replayed.')));
    this.proc.stdin.on('error', e => this.fail(e));
    // Drain stderr without logging credentials, configuration, or user data.
    this.proc.stderr.on('data', () => {});
    this.lines = createInterface({ input: this.proc.stdout });
    this.lines.on('line', line => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      const job = this.pending.get(msg.id);
      if (job && !msg.method) {
        clearTimeout(job.timer); this.pending.delete(msg.id);
        msg.error ? job.reject(new Error(msg.error.message)) : job.resolve(msg.result);
      } else if (msg.id != null && msg.method) this.emit('request', msg);
      else this.emit('notification', msg);
    });
    // If the parent server disappears on Windows, the pipe closes as well.
    if(!this.launcher) {
      const script = 'const parent=Number(process.argv[1]),child=Number(process.argv[2]);const kill=()=>{try{process.kill(child)}catch{}process.exit()};setInterval(()=>{try{process.kill(parent,0)}catch{kill()}},1000);process.stdin.resume();process.stdin.on("data",()=>process.exit());process.stdin.on("end",kill);';
      this.guard = spawn(process.execPath, ['-e',script,String(process.pid),String(this.proc.pid)], {stdio:['pipe','ignore','ignore'],windowsHide:true});
      this.guard.stdin.on('error',()=>{});
      this.guard.on('error',()=>this.fail(new Error('Could not start Codex process supervisor')));
    }
    await this.request('initialize', { clientInfo: { name: 'personal_ai_secretary', title: 'Personal AI Secretary', version: '0.4.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
  }
  send(msg) { if (this.closed || !this.proc?.stdin.writable) throw new Error('Codex connection closed'); this.proc.stdin.write(JSON.stringify(msg) + '\n'); }
  request(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex ' + method + ' timed out')); }, 30000);
      this.pending.set(id, {resolve,reject,timer});
      try { this.send({id,method,params}); } catch(e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  respond(id, result) { this.send({id,result}); }
  fail(error) { if(this.closed)return; this.closed=true; this.guard?.stdin.end("done"); for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(error);} this.pending.clear(); this.proc?.kill(); this.emit('disconnect',error); }
  close() { this.fail(new Error('Codex connection closed')); this.lines?.close(); }
}

export function denyRequest(client, msg) {
  if (msg.method === 'item/commandExecution/requestApproval' || msg.method === 'item/fileChange/requestApproval') client.respond(msg.id, {decision:'decline'});
  else if (msg.method === 'item/permissions/requestApproval') client.respond(msg.id, {permissions:{}});
  else client.send({id:msg.id,error:{code:-32601,message:'Only secretary platform tools are available.'}});
}

// One app-server per turn: persistent threads, no daemon port or orphan long-lived process.
export async function runTurn(client, { threadId, input, effort, onEvent = () => {}, onStarted = () => {}, timeoutMs = 600000 }) {
  let turnId, final = '', timer;
  let resolveDone, rejectDone;
  const done = new Promise((resolve,reject) => {resolveDone=resolve;rejectDone=reject;});
  done.catch(() => {});
  const event = msg => {
    const p=msg.params; if(p?.threadId !== threadId || (turnId && p.turnId && p.turnId !== turnId))return;
    try { onEvent(msg); } catch(e) { rejectDone(e); }
    if(msg.method==='item/completed' && p.item?.type==='agentMessage' && (p.item.phase==='final_answer' || !p.item.phase))final=p.item.text;
    if(msg.method==='turn/completed') p.turn.status==='completed' ? resolveDone(final || p.turn.items?.filter(i=>i.type==='agentMessage').at(-1)?.text || '') : rejectDone(new Error(p.turn.error?.message || 'Codex turn ' + p.turn.status));
  };
  const disconnect=e=>rejectDone(e);
  client.on('notification',event);client.on('disconnect',disconnect);
  timer=setTimeout(()=>{ if(turnId)void client.request('turn/interrupt',{threadId,turnId}).catch(()=>{});rejectDone(new Error('Codex turn timed out. Check task results before submitting again.')); },timeoutMs);
  try {
    const r=await client.request('turn/start',{threadId,input,...(effort?{effort}:{} )});turnId=r.turn.id;await onStarted(turnId);
    return await done;
  } finally { clearTimeout(timer);client.off('notification',event);client.off('disconnect',disconnect); }
}
