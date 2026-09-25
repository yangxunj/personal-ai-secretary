/**
 * 家庭管家 · 桌面端主进程
 *
 * 形状很简单：起一个只听 127.0.0.1 的 Next 服务，再开个窗口指向它。
 *
 * **数据全部在本机**，放在 %APPDATA%/家庭管家/data/：
 *   secretary.db   SQLite 数据库
 *   uploads/       上传的原件
 *   backups/       备份
 *
 * 装在谁的电脑上，数据就在谁的电脑上 —— 开发者没有任何访问路径。
 * 这是桌面端存在的全部理由，所以下面几条不能破：
 *   - Next 服务只绑 127.0.0.1，绝不绑 0.0.0.0
 *     （手机访问走 lan.js 另起的网关：默认关，打开了也只放配对过的设备进来）
 *   - 数据目录在 userData，不在安装目录（安装目录在 Program Files 下没有写权限，
 *     而且卸载/升级会被清掉）
 *   - 不往任何地方上报
 */
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const QRCode = require('qrcode');
const { LanGateway } = require('./lan');

// runtime/ 而不是 app/：electron-builder 会把根目录下的 app/ 当成应用根目录
const APP_DIR = path.join(__dirname, 'runtime');
const RES_DIR = path.join(APP_DIR, 'resources');

let serverProc = null;
let win = null;
let baseUrl = '';
let serverPort = 0;
let lan = null;
let lanWin = null;

// ---------- 数据目录 ----------
/**
 * 数据放哪 —— 装过的放 `%APPDATA%`，免安装的放 exe 旁边。
 *
 * 为什么要分：免安装版的意义就是"拷到 U 盘带走"，数据留在 `%APPDATA%` 的话
 * 带走的是个空壳。反过来，装过的版本**绝不能**把数据放安装目录 —— 卸载会
 * 把整个目录删掉，数据跟着没。
 *
 * 怎么判断是哪一种，按可靠性排序：
 *   1. `PORTABLE_EXECUTABLE_DIR` —— electron-builder 的单文件免安装版会设它
 *   2. 同目录下有没有 `Uninstall *.exe` —— NSIS 装的时候会往安装目录写一个，
 *      解压出来的绿色版没有。**这是区分"装过"和"解压的"最直接的证据**，
 *      比猜路径（Program Files？LocalAppData？用户自己改过？）可靠。
 *   3. 目录写不写得进去 —— 兜底。真放在只读位置就退回 %APPDATA%，
 *      总比启动失败好。
 */
/** 免安装模式下，一切都放 exe 所在目录；否则返回 null */
function portableBase() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;

  // 开发时（npm run dev）exe 是 electron.exe，别往 node_modules 里写东西
  if (!app.isPackaged) return null;

  const exeDir = path.dirname(app.getPath('exe'));
  // 装过的版本必须走 %APPDATA%
  if (fs.readdirSync(exeDir).some((n) => /^Uninstall .*\.exe$/i.test(n))) return null;

  try {
    const probe = path.join(exeDir, '.write-test');
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return exeDir;
  } catch {
    // 放在只读位置（比如光盘、受保护目录）就退回 %APPDATA%，总比起不来好
    return null;
  }
}

const PORTABLE_BASE = portableBase();

// **把 Electron 自己的目录也搬过来。**
//
// 只改我们的 data/ 是不够的：Chromium 的 Cookies、缓存、GPU 数据仍然写在
// %APPDATA%/家庭管家 下。那样"免安装"就是半个 —— 拷到 U 盘带走，人家电脑上
// 还是留了一堆东西。
//
// setPath 必须在 app ready 之前调，所以这段放在模块顶层。
if (PORTABLE_BASE) {
  app.setPath('userData', path.join(PORTABLE_BASE, 'appdata'));
} else if (!app.isPackaged && process.env.HS_USER_DATA) {
  // 只给开发时用：换一个数据目录试，不碰 %APPDATA% 里那份
  app.setPath('userData', process.env.HS_USER_DATA);
}

let cachedRoot = null;
function dataRoot() {
  if (cachedRoot) return cachedRoot;
  cachedRoot = PORTABLE_BASE
    ? path.join(PORTABLE_BASE, 'data')
    : path.join(app.getPath('userData'), 'data');
  return cachedRoot;
}

function dataPaths() {
  const root = dataRoot();
  return {
    root,
    db: path.join(root, 'secretary.db'),
    uploads: path.join(root, 'uploads'),
    backups: path.join(root, 'backups'),
  };
}

function ensureData() {
  const p = dataPaths();
  fs.mkdirSync(p.uploads, { recursive: true });
  fs.mkdirSync(p.backups, { recursive: true });
  // 第一次启动：把打包时生成的空库复制过来。
  // 装到别人电脑上没有 prisma CLI 可用，所以表结构是预先建好的。
  if (!fs.existsSync(p.db)) {
    const template = path.join(RES_DIR, 'template.db');
    if (!fs.existsSync(template)) throw new Error('缺少模板数据库，安装包不完整');
    fs.copyFileSync(template, p.db);
  }
  return p;
}

// ---------- 模型配置 ----------
//
// 安装包里带一份（打包时从根目录 .env 抽的）。用户想换成自己的 key，
// 在数据目录旁边放一个 config.json 就能覆盖 —— 不用重装。
function aiConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(RES_DIR, 'ai.json'), 'utf8'));
  } catch {
    // 没有就算了，下面 override 还有机会
  }
  // 跟 data/ 放同一级：免安装版就在 exe 旁边，装过的版本在 %APPDATA%。
  // 现在设置页里能直接填 key，这个文件基本只剩"批量预置"一个用途。
  const override = path.join(dataRoot(), '..', 'config.json');
  if (fs.existsSync(override)) {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(override, 'utf8')));
    } catch (e) {
      console.error('config.json 格式不对，忽略:', e.message);
    }
  }
  return cfg;
}

// ---------- 端口 ----------
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    // 端口交给系统挑。写死的话，用户机器上那个端口被别的东西占了就起不来，
    // 而这种问题在他那边完全没法排查。
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// ---------- 起服务 ----------
async function startServer() {
  const p = ensureData();
  const port = await freePort();
  const cfg = aiConfig();

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    // 只听本机。绑 0.0.0.0 的话同一个 WiFi 下的人就能直接连进来看他的资料。
    HOSTNAME: '127.0.0.1',

    // Prisma 的 SQLite URL 要正斜杠，Windows 的反斜杠会被当转义
    DATABASE_URL: `file:${p.db.replace(/\\/g, '/')}`,
    UPLOAD_DIR: p.uploads,
    BACKUP_DIR: p.backups,

    // 本机应用不做登录：服务只听 127.0.0.1，没有网络侧的攻击面，
    // 再要一道密码只是给自己找麻烦（跟 Obsidian、VS Code 一个道理）。
    // env-guard 要求「关掉防线必须是显式的」，所以这里明写。
    ALLOW_INSECURE_LOCAL: 'true',
    AUTH_ENABLED: 'false',
    // 设置页据此显示「用手机访问在菜单里」—— 网页版没有这个功能
    DESKTOP_APP: '1',

    AI_BASE_URL: cfg.AI_BASE_URL ?? '',
    AI_API_KEY: cfg.AI_API_KEY ?? '',
    AI_MODEL: cfg.AI_MODEL ?? '',
  };

  // 用 Electron 自带的 Node 跑 standalone 的 server.js。
  // ELECTRON_RUN_AS_NODE=1 让这个进程当纯 Node 用，不开窗口、不加载 Chromium。
  // 好处是**不用额外往安装包里塞一份 Node 运行时**。
  serverProc = spawn(process.execPath, [path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR,
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`[next] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`[next] ${d}`));
  serverProc.on('exit', (code) => {
    if (code !== 0 && !app.isQuitting) {
      dialog.showErrorBox('后台服务退出了', `退出码 ${code}。重启一下试试。`);
    }
  });

  serverPort = port;
  baseUrl = `http://127.0.0.1:${port}`;
  await waitReady(baseUrl);
  return baseUrl;
}

/** 轮询到服务应答为止。冷启动要几秒，过早 loadURL 会白屏 */
function waitReady(url, timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('后台服务启动超时'));
        else setTimeout(tick, 300);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

// ---------- 窗口 ----------
function createWindow(url) {
  win = new BrowserWindow({
    // 宽屏布局在 lg（1024px）起生效：左侧栏 + 加宽内容区。
    // 默认宽度要稳稳越过那个断点，否则一打开是手机样子的底栏，
    // 在桌面上看着像个跑错地方的 App。
    //
    // 窗口拖窄到 1024 以下会自动切回底栏那套 —— 这也让它天然是个断点测试台。
    width: 1180,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    title: '家庭管家',
    backgroundColor: '#ffffff',
    // ⚠ 别设 autoHideMenuBar —— 隐藏之后要按 Alt 才冒出来，等于没有。
    // 第一版设了 true，结果使用者根本找不到「在哪儿填 API Key」：
    // 菜单看不见，页面上就只剩首页右上角一个灰色小齿轮。
    // 桌面软件的菜单栏就是人找设置的第一个地方，让它一直在。
    autoHideMenuBar: false,
    webPreferences: {
      // 页面里没有任何需要 Node 的地方，关掉是基本功
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadURL(url);

  // 页面里的外链（比如以后的帮助文档）走系统浏览器，别在应用窗口里开
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });
}

// ---------- 手机访问 ----------
function startLan() {
  lan = new LanGateway({
    // 跟 config.json 同一层：免安装版在 exe 旁边，装过的在 %APPDATA%
    stateFile: path.join(dataRoot(), '..', 'lan.json'),
    targetPort: () => serverPort,
    onChange: () => lanWin?.webContents.send('lan:changed'),
  });
  // 上次开着就接着开 —— 手机主屏上那个图标，不该因为电脑重启过就打不开
  if (lan.state.enabled) lan.start().catch((e) => console.error('手机访问没起来:', e));

  ipcMain.handle('lan:state', async () => {
    const s = lan.snapshot();
    return { ...s, qr: s.url ? await QRCode.toString(s.url, { type: 'svg', margin: 1 }) : null };
  });
  ipcMain.handle('lan:set-enabled', (_e, on) => lan.setEnabled(on));
  ipcMain.handle('lan:set-address', (_e, a) => lan.setAddress(a));
  ipcMain.handle('lan:new-code', () => {
    lan.newCode();
    lan.onChange();
  });
  ipcMain.handle('lan:remove-device', (_e, id) => lan.removeDevice(id));
}

/**
 * 「用手机访问」是个本地小窗口，不是 Next 里的一页。
 * 那一页手机也打得开 —— 配对过的手机就能自己发二维码、踢掉别的设备。
 * 放在只有这台电脑上才有的窗口里，开关和配对就只有坐在电脑前的人能动。
 */
function openLanWindow() {
  if (lanWin) return lanWin.focus();
  lanWin = new BrowserWindow({
    width: 640,
    height: 720,
    minWidth: 520,
    title: '用手机访问',
    parent: win ?? undefined,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'lan-preload.js'),
    },
  });
  lanWin.setMenu(null);
  lanWin.loadFile(path.join(__dirname, 'lan.html'));
  lanWin.on('closed', () => (lanWin = null));
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '设置',
        submenu: [
          {
            // 独立一个顶级菜单，不塞进「文件」里。这是使用者最可能来找的东西
            // （「我的 API Key 填哪儿」），埋一层就等于没有。
            label: 'AI 模型 / API Key…',
            click: () => win?.loadURL(baseUrl + '/settings'),
          },
          {
            label: '用手机访问…',
            click: () => openLanWindow(),
          },
          {
            label: '打开数据文件夹',
            // 让用户随时能看见「我的数据就在这儿」—— 这比任何说明都有说服力
            click: () => shell.openPath(dataPaths().root),
          },
        ],
      },
      {
        label: '文件',
        submenu: [{ role: 'quit', label: '退出' }],
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新加载' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { role: 'resetZoom', label: '恢复默认大小' },
          { type: 'separator' },
          { role: 'toggleDevTools', label: '开发者工具' },
        ],
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '关于',
            click: () =>
              dialog.showMessageBox({
                type: 'info',
                title: '关于家庭管家',
                message: `家庭管家 ${app.getVersion()}`,
                detail:
                  '你的数据全部保存在这台电脑上：\n' +
                  dataPaths().root +
                  '\n\n没有任何数据上传到开发者的服务器。\n\n' +
                  '唯一的例外：跟 AI 对话时，你发的内容会传给模型服务商' +
                  '（阿里云百炼）——AI 要读到账单才能帮你录入。' +
                  '不想让 AI 看的东西就别发给它。',
              }),
          },
        ],
      },
    ])
  );
}

// ---------- 生命周期 ----------
// 开两个窗口会有两个进程抢同一个 SQLite 文件，直接挡掉
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      const url = await startServer();
      createWindow(url);
      startLan();
      // 只给开发时用：自动化测试没法点原生菜单
      if (!app.isPackaged && process.env.HS_OPEN_LAN) openLanWindow();
    } catch (e) {
      dialog.showErrorBox('启动失败', String(e?.message ?? e));
      app.quit();
    }
  });
}

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  app.isQuitting = true;
  lan?.dispose();
  // 不杀的话后台那个 node 会留着，下次启动又起一个，慢慢堆一堆孤儿进程
  if (serverProc && !serverProc.killed) serverProc.kill();
});
