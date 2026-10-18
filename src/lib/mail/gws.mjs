import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const METHODS = new Set(['getProfile', 'messages.list', 'messages.get', 'history.list']);

export function mailEnvironment(configDir, inherited = process.env) {
  const env = { ...inherited };
  // 不能意外使用另一邮箱或其他项目的凭据；配置目录由调用方逐次明确传入。
  for (const name of ['GOOGLE_WORKSPACE_CLI_TOKEN', 'GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_WORKSPACE_CLI_CLIENT_ID', 'GOOGLE_WORKSPACE_CLI_CLIENT_SECRET', 'GOOGLE_WORKSPACE_PROJECT_ID', 'GOOGLE_WORKSPACE_CLI_LOG', 'GOOGLE_WORKSPACE_CLI_LOG_FILE', 'GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND']) delete env[name];
  env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = configDir;
  return env;
}

export class GwsMailReader {
  constructor({ executable, configDir, execute = run, signal }) {
    this.executable = executable; this.configDir = configDir; this.execute = execute; this.signal = signal;
  }
  async call(method, params = {}) {
    if (!METHODS.has(method)) throw new Error('邮箱试点仅允许Gmail读取操作');
    const parts = method.split('.');
    const args = ['gmail', 'users', ...parts, '--params', JSON.stringify({ ...params, userId: 'me' })];
    let result, guard;
    try {
      const pending = this.execute(this.executable, args, { cwd: this.configDir, env: mailEnvironment(this.configDir), signal: this.signal, windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      if (pending.child?.pid) {
        // Only supervise this call's child. If Electron's server is terminated, close GWS too.
        const script = 'const p=+process.argv[1],c=+process.argv[2];const stop=()=>{try{process.kill(c)}catch{}process.exit()};setInterval(()=>{try{process.kill(p,0)}catch{stop()}},1000);process.stdin.resume();process.stdin.on("data",()=>process.exit());process.stdin.on("end",stop);';
        guard = spawn(process.execPath, ['-e', script, String(process.pid), String(pending.child.pid)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
        guard.stdin.on('error', () => {}); guard.on('error', () => pending.child.kill());
      }
      result = await pending;
    } catch (error) {
      // 不把CLI原始stdout/stderr带到网页或日志，防止凭据与邮件正文被错误回显。
      let status;
      try { status = JSON.parse(error.stdout || '{}').error?.code; } catch {}
      const failure = new Error(`Gmail读取失败（${method}，状态${status ?? error.code ?? '未知'}）；请检查授权、API启用状态或网络。`);
      failure.status = status;
      throw failure;
    } finally { guard?.stdin.end('done'); }
    try { return JSON.parse(result.stdout); } catch { throw new Error('Gmail工具未返回有效JSON'); }
  }
  async profile(expectedEmail) {
    const profile = await this.call('getProfile');
    if (!expectedEmail || profile.emailAddress?.toLowerCase() !== expectedEmail.toLowerCase()) throw new Error('连接邮箱与本次指定账号不一致，已停止试读');
    return profile;
  }
  list(params) { return this.call('messages.list', params); }
  message(id, metadata = false) {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) throw new Error('Gmail邮件编号无效');
    return this.call('messages.get', { id, format: metadata ? 'metadata' : 'full', ...(metadata ? { metadataHeaders: ['Subject', 'From', 'Date'] } : {}) });
  }
}

function htmlText(value) {
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(br|\/p|\/div|\/tr|\/li)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const n = /^x/i.test(code) ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }).replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name.toLowerCase()]);
}
export function normalizeMail(message, account) {
  const headers = message.payload?.headers ?? [];
  const header = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  const plain = [], html = [], attachments = [];
  function walk(part) {
    if (part.filename) { attachments.push(part.filename); return; }
    const body = part.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf8') : '';
    if (part.mimeType === 'text/plain') plain.push(body);
    else if (part.mimeType === 'text/html') html.push(htmlText(body));
    for (const child of part.parts ?? []) walk(child);
  }
  if (message.payload) walk(message.payload);
  const body = (plain.length ? plain.join('\n') : html.join('\n')).trim();
  return { id: message.id, threadId: message.threadId, account, subject: header('Subject'), from: header('From'), date: header('Date'), internalDate: message.internalDate,
    snippet: message.snippet ?? '', body: body.slice(0, 12000), bodyTruncated: body.length > 12000, attachments,
    sourceUrl: /^[a-zA-Z0-9_-]+$/.test(message.threadId ?? '') ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${message.threadId}` : null };
}
