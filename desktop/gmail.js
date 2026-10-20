const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const FORWARDED = new Set(['configure', 'sync', 'pause', 'mark', 'task']);

function gmailEnvironment(configDir, inherited = process.env) {
  const env = { ...inherited };
  for (const key of ['GOOGLE_WORKSPACE_CLI_TOKEN', 'GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_WORKSPACE_CLI_CLIENT_ID', 'GOOGLE_WORKSPACE_CLI_CLIENT_SECRET', 'GOOGLE_WORKSPACE_PROJECT_ID', 'GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND', 'GOOGLE_WORKSPACE_CLI_LOG', 'GOOGLE_WORKSPACE_CLI_LOG_FILE']) delete env[key];
  env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = configDir;
  return env;
}
function validClient(json) {
  const value = json?.installed;
  if (!value || typeof value.client_id !== 'string' || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(value.client_id)
    || typeof value.client_secret !== 'string' || !value.client_secret.length || value.client_secret.length > 500
    || value.auth_uri !== 'https://accounts.google.com/o/oauth2/auth' || value.token_uri !== 'https://oauth2.googleapis.com/token') throw new Error('MAIL_CLIENT_INVALID');
  return { installed: { client_id: value.client_id, client_secret: value.client_secret, auth_uri: value.auth_uri, token_uri: value.token_uri,
    ...(typeof value.project_id === 'string' ? { project_id: value.project_id } : {}),
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    redirect_uris: ['http://localhost'] } };
}
function authorizationUrl(text) {
  for (const raw of text.match(/https:\/\/accounts\.google\.com\/[^\s"<>]+/g) || []) {
    try {
      const url = new URL(raw);
      if (url.hostname === 'accounts.google.com' && url.searchParams.get('response_type') === 'code'
        && (url.searchParams.get('scope') || '').split(/\s+/).every(s => [SCOPE, 'openid', 'email', 'profile', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'].includes(s))) return url.href;
    } catch {}
  }
  return null;
}
function trustedSender(event, win, baseUrl) {
  try { return !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && new URL(event.senderFrame.url).origin === new URL(baseUrl).origin; }
  catch { return false; }
}

function readBundledClient(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    if (fs.statSync(file).size > 65536) throw new Error();
    const preset = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (preset.version !== 1 || typeof preset.testing !== 'boolean') throw new Error();
    return { client: validClient(preset.client), testing: preset.testing };
  } catch { throw new Error('MAIL_CLIENT_INVALID'); }
}
function clientStatus(account, bundledClientPath) {
  const saved = path.join(account, 'client_secret.json');
  let bundled = null;
  try { bundled = readBundledClient(bundledClientPath); } catch {}
  let source = fs.existsSync(saved) ? 'custom' : bundled ? 'bundled' : 'none';
  if (source === 'custom' && bundled) {
    try { if (JSON.parse(fs.readFileSync(saved, 'utf8')).installed?.client_id === bundled.client.installed.client_id) source = 'bundled'; } catch {}
  }
  return { clientReady: source !== 'none', clientSource: source, bundledClientReady: !!bundled, clientTesting: source === 'bundled' && !!bundled?.testing };
}
async function ensureGmailClient(account, bundledClientPath) {
  const file = path.join(account, 'client_secret.json');
  if (fs.existsSync(file)) {
    try { validClient(JSON.parse(await fsp.readFile(file, 'utf8'))); } catch { throw new Error('MAIL_CLIENT_INVALID'); }
    return;
  }
  const bundled = readBundledClient(bundledClientPath);
  if (!bundled) throw new Error('MAIL_CLIENT_REQUIRED');
  await fsp.mkdir(account, { recursive: true });
  // Do not replace a user-imported client if another action installed it meanwhile.
  try { await fsp.writeFile(file, JSON.stringify(bundled.client), { mode: 0o600, flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

function setupGmail({ ipcMain, dialog, shell, Notification, getWindow, getBaseUrl, token, root, executable, getLocale, bundledClientPath }) {
  const account = path.join(root, 'account');
  let auth = null, authError = null, authUrl = null, timer, polling = false, disposed = false;
  async function call(action, input) {
    const response = await fetch(getBaseUrl() + '/api/desktop/gmail', { method: 'POST', headers: { 'content-type': 'application/json', 'x-desktop-gmail': token },
      body: JSON.stringify({ action, input }), signal: AbortSignal.timeout(20000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'MAIL_OPERATION_FAILED'); return result;
  }
  async function status() {
    return { ...(await call('status')), toolReady: fs.existsSync(executable), ...clientStatus(account, bundledClientPath),
      authorizing: !!auth, authError, authUrl };
  }
  async function clearAccount() {
    if (!fs.existsSync(account)) return;
    if ((await fsp.lstat(account)).isSymbolicLink() || path.dirname(path.resolve(account)) !== path.resolve(root)) throw new Error('MAIL_DIRECTORY_INVALID');
    await fsp.rm(account, { recursive: true, force: true });
  }
  async function cancelAuth() {
    const active = auth;
    if (active) { active.cancelled = true; active.profileAbort.abort(); active.proc.kill(); await active.done; }
  }
  async function connect() {
    if (auth) return status();
    if ((await call('status')).connected) throw new Error('MAIL_DISCONNECT_FIRST');
    if (!fs.existsSync(executable)) throw new Error('MAIL_TOOL_MISSING');
    await ensureGmailClient(account, bundledClientPath);
    const proc = spawn(executable, ['auth', 'login', '--scopes', SCOPE], { cwd: account, env: gmailEnvironment(account), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const active = { proc, cancelled: false, profileAbort: new AbortController(), done: null }; auth = active; authError = null;
    let buffer = ''; authUrl = null;
    const timeout = setTimeout(() => { authError = 'MAIL_AUTH_TIMEOUT'; active.cancelled = true; proc.kill(); }, 5 * 60000);
    const output = chunk => {
      buffer = (buffer + chunk.toString('utf8')).slice(-16000);
      // GWS opens the system browser itself. Keep a validated fallback link only.
      authUrl ??= authorizationUrl(buffer);
    };
    proc.stdout.on('data', output); proc.stderr.on('data', output);
    active.done = new Promise(resolve => {
      let completed = false;
      const finish = async code => {
        if (completed) return; completed = true; clearTimeout(timeout);
        try {
          if (!active.cancelled && code === 0) {
            const result = await run(executable, ['gmail', 'users', 'getProfile', '--params', '{"userId":"me"}'], { cwd: account, env: gmailEnvironment(account), signal: active.profileAbort.signal, timeout: 30000, windowsHide: true, maxBuffer: 65536 });
            if (!disposed && !active.cancelled) await call('connected', { email: JSON.parse(result.stdout).emailAddress });
          } else if (!active.cancelled) authError = 'MAIL_AUTH_FAILED';
        } catch { authError = 'MAIL_AUTH_FAILED'; }
        finally { if (auth === active) auth = null; authUrl = null; buffer = ''; resolve(); }
      };
      proc.once('error', () => { authError = 'MAIL_AUTH_FAILED'; void finish(1); });
      proc.once('close', code => { void finish(code); });
    });
    return status();
  }
  ipcMain.handle('gmail:command', async (event, action, input = {}) => {
    if (!trustedSender(event, getWindow(), getBaseUrl())) return { error: 'MAIL_DESKTOP_ONLY' };
    try {
      if (action === 'status') return await status();
      if (action === 'import') {
        if (auth || (await call('status')).connected) throw new Error('MAIL_DISCONNECT_FIRST');
        const chosen = await dialog.showOpenDialog(getWindow(), { properties: ['openFile'], filters: [{ name: 'Google Desktop OAuth JSON', extensions: ['json'] }] });
        if (!chosen.canceled && chosen.filePaths[0]) {
          const file = chosen.filePaths[0]; if ((await fsp.stat(file)).size > 65536) throw new Error('MAIL_CLIENT_INVALID');
          const json = validClient(JSON.parse(await fsp.readFile(file, 'utf8')));
          await fsp.mkdir(account, { recursive: true }); await fsp.writeFile(path.join(account, 'client_secret.json'), JSON.stringify(json), { mode: 0o600 });
        }
      } else if (action === 'default') {
        if (auth || (await call('status')).connected) throw new Error('MAIL_DISCONNECT_FIRST');
        if (!readBundledClient(bundledClientPath)) throw new Error('MAIL_CLIENT_REQUIRED');
        await clearAccount(); authError = null;
      } else if (action === 'connect') return await connect();
      else if (action === 'cancel') await cancelAuth();
      else if (action === 'disconnect') {
        await cancelAuth(); await call('disconnect');
        await clearAccount();
        authError = null;
      } else if (FORWARDED.has(action)) { const result = await call(action, input); return { ...result, toolReady: fs.existsSync(executable), ...clientStatus(account, bundledClientPath), authorizing: !!auth, authError, authUrl }; }
      else throw new Error('MAIL_INVALID_ACTION');
      return await status();
    } catch (error) { return { error: /^MAIL_[A-Z_]+$/.test(error.message) ? error.message : 'MAIL_OPERATION_FAILED' }; }
  });
  timer = setInterval(async () => {
    if (polling || disposed || !Notification.isSupported()) return; polling = true;
    try {
      const { count } = await call('notifications');
      if (count) {
        const chinese = getLocale() !== 'en';
        const note = new Notification({ title: chinese ? '家庭管家' : 'Household Steward', body: chinese ? '有新的邮件线索需要关注，点击查看。' : 'New mail needs your attention. Click to review.' });
        note.on('click', () => { const win = getWindow(); if (win) { win.show(); win.focus(); win.loadURL(getBaseUrl() + '/mail'); } }); note.show();
      }
    } catch {} finally { polling = false; }
  }, 20000); timer.unref?.();
  return {
    async shutdown() { disposed = true; clearInterval(timer); await Promise.allSettled([cancelAuth(), call('stop')]); },
    dispose() { disposed = true; clearInterval(timer); if (auth) { auth.cancelled = true; auth.profileAbort.abort(); auth.proc.kill(); } ipcMain.removeHandler('gmail:command'); },
  };
}
module.exports = { setupGmail, gmailEnvironment, validClient, authorizationUrl, trustedSender, readBundledClient, clientStatus, ensureGmailClient };
