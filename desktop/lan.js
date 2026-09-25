/**
 * 手机访问 —— 局域网网关。
 *
 * Next 服务仍然**只听 127.0.0.1、没有登录**，这一条没动。手机要连进来，
 * 走的是这里另起的一个 0.0.0.0 上的入口：认得的设备原样转发给 Next，
 * 认不得的一律 403。
 *
 * 为什么把关卡放在这儿而不是 Next 的 middleware：
 *   - 这里拿得到**真实的对端地址**（socket），middleware 只能看请求头，
 *     而 Host / X-Forwarded-For 是局域网里任何人都能伪造的。
 *   - Next 那边「本机免登录」的前提不用推翻：它照旧只有本机连得上。
 *   - 默认关着。不打开，这台电脑对局域网就跟以前一样什么都没开。
 *
 * 认设备靠配对，不靠密码：电脑上显示二维码（里面是一次性配对码），
 * 手机扫了就发一张长期有效的设备凭证（cookie）。库里只存它的哈希。
 * 配对码用一次就换新的，10 分钟不用也作废 —— 二维码被人拍走也没用。
 */
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');

const COOKIE = 'hs_device';
const PAIR_PREFIX = '/__pair/';
const CODE_TTL_MS = 10 * 60 * 1000;
/** 首选端口，被占了就往后顺延几个 */
const DEFAULT_PORT = 8790;
/** 最近使用时间不用每个请求都落盘 */
const SEEN_FLUSH_MS = 60 * 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = (bytes) => crypto.randomBytes(bytes).toString('base64url');

/** 从 User-Agent 猜个人话名字，设备列表里用 —— 猜不准也不要紧，只是给人认 */
function deviceName(ua = '') {
  const os_ = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? (ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/)?.[1] ?? 'Android 手机')
        : /Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows 电脑'
            : '未知设备';
  const br = /MicroMessenger/.test(ua)
    ? '微信'
    : /EdgA?\//.test(ua)
      ? 'Edge'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '';
  return br ? `${os_} · ${br}` : os_;
}

/**
 * 本机的局域网地址，最像「家里 WiFi」的排前面。
 *
 * 一台 Windows 上常见一堆虚拟网卡（Hyper-V、WSL、VMware、Docker），它们的
 * 172.x / 192.168.x 手机根本到不了。按网卡名剔掉，而不是按网段 ——
 * 网段猜不准，家用路由器也有发 10.x 的。Tailscale 留着排最后：
 * 手机也装了 Tailscale 的话，出了家门走它也能连。
 */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue; // 没拿到地址时的自分配
      const tailscale = /tailscale/i.test(name) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address);
      const virtual = /vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|loopback|vpn|tap|tun/i.test(name);
      let score = 0;
      if (/wi-?fi|wlan|无线/i.test(name)) score += 30;
      if (/ethernet|以太网/i.test(name)) score += 20;
      if (a.address.startsWith('192.168.')) score += 10;
      // 虚拟网卡（WSL、Hyper-V、VMware）手机永远到不了，列出来只会让人选错
      if (virtual && !tailscale) continue;
      if (tailscale) score -= 50;
      out.push({ address: a.address, iface: name, tailscale, score });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

function page(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{margin:0;font:16px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f6f7fb;color:#1c2230;
display:grid;place-items:center;min-height:100dvh;padding:24px;box-sizing:border-box}
main{max-width:420px;background:#fff;border-radius:18px;padding:28px 24px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 12px}p{margin:0 0 10px;color:#4a5263}b{color:#1c2230}
@media (prefers-color-scheme:dark){body{background:#10141c;color:#e6e9f0}main{background:#1a1f2b;box-shadow:none}p{color:#a3abbb}b{color:#e6e9f0}}
</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
}

class LanGateway {
  /**
   * @param {object} o
   * @param {string} o.stateFile  设置和已配对设备存哪（跟 config.json 同一层）
   * @param {() => number} o.targetPort  Next 服务的本机端口
   * @param {() => void} o.onChange  状态变了（配上一台新设备、开关、换码），通知窗口刷新
   */
  constructor({ stateFile, targetPort, onChange }) {
    this.stateFile = stateFile;
    this.targetPort = targetPort;
    this.onChange = onChange ?? (() => {});
    this.server = null;
    this.port = null;
    this.error = null;
    this.code = null;
    this.state = this.load();
    this.seenDirty = false;
    this.seenTimer = setInterval(() => this.flushSeen(), SEEN_FLUSH_MS);
    this.seenTimer.unref?.();
  }

  load() {
    try {
      const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return { enabled: !!s.enabled, port: s.port || DEFAULT_PORT, address: s.address ?? null, devices: s.devices ?? [] };
    } catch {
      return { enabled: false, port: DEFAULT_PORT, address: null, devices: [] };
    }
  }

  save() {
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    this.seenDirty = false;
  }

  flushSeen() {
    if (this.seenDirty) this.save();
  }

  // ---------- 开关 ----------

  async setEnabled(on) {
    this.state.enabled = !!on;
    this.save();
    if (on) await this.start();
    else await this.stop();
    this.onChange();
  }

  async start() {
    if (this.server) return;
    this.error = null;
    const server = http.createServer((req, res) => this.handle(req, res));
    // 对话是流式的，一轮可能好几分钟 —— Node 默认 5 分钟的请求超时会把它掐断
    server.requestTimeout = 0;
    server.on('upgrade', (_req, socket) => socket.destroy());

    for (let p = this.state.port; p < this.state.port + 10; p++) {
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(p, '0.0.0.0', () => {
            server.off('error', reject);
            resolve();
          });
        });
        this.server = server;
        this.port = p;
        this.newCode();
        return;
      } catch (e) {
        if (e.code !== 'EADDRINUSE') {
          this.error = `打不开端口 ${p}：${e.message}`;
          return;
        }
      }
    }
    this.error = `端口 ${this.state.port}~${this.state.port + 9} 都被占了`;
  }

  async stop() {
    this.code = null;
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    this.port = null;
    // closeAllConnections：手机上开着的页面有长连接，不断掉的话 close 会一直等
    s.closeAllConnections?.();
    await new Promise((r) => s.close(() => r()));
  }

  // ---------- 配对 ----------

  newCode() {
    this.code = { value: token(16), expires: Date.now() + CODE_TTL_MS };
    return this.code;
  }

  /** 二维码里的地址。address 为空就用排第一的 */
  pairUrl() {
    if (!this.port || !this.code) return null;
    const addrs = lanAddresses();
    const addr = addrs.find((a) => a.address === this.state.address)?.address ?? addrs[0]?.address;
    if (!addr) return null;
    return `http://${addr}:${this.port}${PAIR_PREFIX}${this.code.value}`;
  }

  setAddress(address) {
    this.state.address = address || null;
    this.save();
    this.onChange();
  }

  removeDevice(id) {
    this.state.devices = this.state.devices.filter((d) => d.id !== id);
    this.save();
    this.onChange();
  }

  snapshot() {
    // 过期了就当场换一张，窗口上永远是能扫的
    if (this.server && (!this.code || this.code.expires < Date.now())) this.newCode();
    return {
      enabled: this.state.enabled,
      running: !!this.server,
      port: this.port,
      error: this.error,
      url: this.pairUrl(),
      codeExpires: this.code?.expires ?? null,
      address: this.state.address,
      addresses: lanAddresses(),
      devices: this.state.devices.map(({ id, name, createdAt, lastSeen }) => ({ id, name, createdAt, lastSeen })),
    };
  }

  // ---------- 请求 ----------

  deviceOf(req) {
    const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    if (!m) return null;
    const h = sha256(m[1]);
    return this.state.devices.find((d) => d.hash === h) ?? null;
  }

  handle(req, res) {
    const url = req.url ?? '/';

    if (url.startsWith(PAIR_PREFIX)) return this.pair(req, res, url.slice(PAIR_PREFIX.length).split('?')[0]);

    const dev = this.deviceOf(req);
    if (!dev) {
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(
        page(
          '这台设备还没配对',
          '<p>为了不让同一个 WiFi 下的其他人看到你的资料，手机要先跟电脑配对一次。</p>' +
            '<p>在电脑上打开家庭管家，点菜单 <b>设置 → 用手机访问</b>，用手机扫那个二维码。</p>'
        )
      );
    }

    dev.lastSeen = new Date().toISOString();
    this.seenDirty = true;
    this.forward(req, res);
  }

  pair(req, res, code) {
    const ok = this.code && code === this.code.value && this.code.expires > Date.now();
    if (!ok) {
      res.writeHead(410, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(
        page(
          '二维码已经失效',
          '<p>每个二维码只能用一次，10 分钟不用也会作废。</p>' +
            '<p>在电脑上的「用手机访问」窗口里会自动换一个新的，再扫一次就行。</p>'
        )
      );
    }
    const t = token(32);
    const now = new Date().toISOString();
    this.state.devices.push({
      id: token(6),
      name: deviceName(req.headers['user-agent']),
      hash: sha256(t),
      createdAt: now,
      lastSeen: now,
    });
    this.save();
    this.newCode(); // 用过即换
    this.onChange();
    res.writeHead(302, {
      // 400 天是浏览器允许的上限；过期了重新扫一次就行
      'set-cookie': `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${400 * 86400}`,
      location: '/',
      'cache-control': 'no-store',
    });
    res.end();
  }

  forward(req, res) {
    const headers = { ...req.headers };
    // 设备凭证只给网关看，别带进 Next（日志、报错页里都可能出现请求头）
    if (headers.cookie) {
      const rest = headers.cookie
        .split(/;\s*/)
        .filter((c) => !c.startsWith(COOKIE + '='))
        .join('; ');
      if (rest) headers.cookie = rest;
      else delete headers.cookie;
    }
    // Host 原样带过去：Next 的 Server Action 要拿 Origin 跟 Host 比对，改了就全被当成跨站拒掉
    headers['x-forwarded-for'] = req.socket.remoteAddress ?? '';

    const up = http.request(
      { host: '127.0.0.1', port: this.targetPort(), method: req.method, path: req.url, headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      }
    );
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('电脑上的家庭管家没响应，稍后再试');
    });
    // 手机中途关了页面，别让后面那条请求一直挂着
    res.on('close', () => up.destroy());
    req.pipe(up);
  }

  async dispose() {
    clearInterval(this.seenTimer);
    this.flushSeen();
    await this.stop();
  }
}

module.exports = { LanGateway, lanAddresses, deviceName };
