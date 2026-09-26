/**
 * 桌面外壳（菜单、对话框、「用手机访问」窗口、配对页）的中英文。
 *
 * 跟 Next 那边（src/lib/i18n）是两套：这里是主进程，碰不到 React 也碰不到库，
 * 字符串也就三十来条，用短 key 就够了。
 *
 * 当前语言从哪来：启动时先按系统语言猜（app.getLocale()），
 * 页面加载完再问一次 Next 的 /api/locale —— 设置页里切了语言，
 * 下一次页面跳转菜单就跟着换（见 main.js 的 syncLocale）。
 */
const STR = {
  zh: {
    appName: '家庭管家',
    menuSettings: '设置',
    menuAiKey: 'AI 模型 / API Key…',
    menuLan: '用手机访问…',
    menuDataFolder: '打开数据文件夹',
    menuFile: '文件',
    quit: '退出',
    menuView: '视图',
    reload: '重新加载',
    zoomIn: '放大',
    zoomOut: '缩小',
    resetZoom: '恢复默认大小',
    devTools: '开发者工具',
    menuHelp: '帮助',
    about: '关于',
    aboutTitle: '关于家庭管家',
    aboutDetail:
      '你的数据全部保存在这台电脑上：\n{dir}\n\n没有任何数据上传到开发者的服务器。\n\n' +
      '唯一的例外：跟 AI 对话时，你发的内容会传给你选的模型服务商 —— ' +
      'AI 要读到账单才能帮你录入。不想让 AI 看的东西就别发给它。',
    lanTitle: '用手机访问',
    serverExited: '后台服务退出了',
    serverExitedDetail: '退出码 {code}。重启一下试试。',
    serverTimeout: '后台服务启动超时',
    startFailed: '启动失败',
    missingTemplate: '缺少模板数据库，安装包不完整',
    // lan.js
    androidPhone: 'Android 手机',
    windowsPc: 'Windows 电脑',
    unknownDevice: '未知设备',
    wechat: '微信',
    portFailed: '打不开端口 {port}：{msg}',
    portsBusy: '端口 {from}~{to} 都被占了',
    notPairedTitle: '这台设备还没配对',
    notPairedBody:
      '<p>为了不让同一个 WiFi 下的其他人看到你的资料，手机要先跟电脑配对一次。</p>' +
      '<p>在电脑上打开家庭管家，点菜单 <b>设置 → 用手机访问</b>，用手机扫那个二维码。</p>',
    codeExpiredTitle: '二维码已经失效',
    codeExpiredBody:
      '<p>每个二维码只能用一次，10 分钟不用也会作废。</p>' +
      '<p>在电脑上的「用手机访问」窗口里会自动换一个新的，再扫一次就行。</p>',
    upstreamDown: '电脑上的家庭管家没响应，稍后再试',
  },
  en: {
    appName: 'Household Steward',
    menuSettings: 'Settings',
    menuAiKey: 'AI model / API key…',
    menuLan: 'Phone access…',
    menuDataFolder: 'Open data folder',
    menuFile: 'File',
    quit: 'Quit',
    menuView: 'View',
    reload: 'Reload',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetZoom: 'Actual size',
    devTools: 'Developer tools',
    menuHelp: 'Help',
    about: 'About',
    aboutTitle: 'About Household Steward',
    aboutDetail:
      'All your data is stored on this computer:\n{dir}\n\nNothing is uploaded to the developer.\n\n' +
      'The one exception: when you chat with the AI, what you send goes to the model provider you chose — ' +
      'the AI has to read a bill to enter it for you. If you don’t want the AI to see something, don’t send it.',
    lanTitle: 'Phone access',
    serverExited: 'The background service stopped',
    serverExitedDetail: 'Exit code {code}. Try restarting the app.',
    serverTimeout: 'The background service took too long to start',
    startFailed: 'Failed to start',
    missingTemplate: 'The template database is missing — the installation is incomplete',
    androidPhone: 'Android phone',
    windowsPc: 'Windows PC',
    unknownDevice: 'Unknown device',
    wechat: 'WeChat',
    portFailed: 'Couldn’t open port {port}: {msg}',
    portsBusy: 'Ports {from}–{to} are all in use',
    notPairedTitle: 'This device isn’t paired yet',
    notPairedBody:
      '<p>So that other people on the same Wi-Fi can’t see your data, your phone needs to be paired with the computer once.</p>' +
      '<p>On the computer, open Household Steward, choose <b>Settings → Phone access</b> from the menu, and scan the QR code with your phone.</p>',
    codeExpiredTitle: 'This QR code has expired',
    codeExpiredBody:
      '<p>Each QR code works once, and expires after 10 minutes.</p>' +
      '<p>The Phone access window on the computer switches to a new one automatically — just scan again.</p>',
    upstreamDown: 'Household Steward on the computer isn’t responding. Try again in a moment.',
  },
};

/** 「用手机访问」窗口（lan.html）里的文字，随状态一起发过去 */
const LAN_UI = {
  zh: {
    lang: 'zh-CN',
    title: '用手机访问',
    loading: '读取中…',
    toggleHint: '允许同一个 WiFi 下配对过的手机访问',
    pairHeading: '配对一台手机',
    step1: '手机连上<b>跟这台电脑同一个 WiFi</b>',
    step2: '用手机相机或微信扫左边的二维码',
    step3: '打开后点浏览器的「添加到主屏幕」，以后就像 App 一样点开',
    oneUse: '二维码只能用一次，扫完自动换新的，可以接着配下一台。',
    expiresIn: ' 这一张 {n} 分钟后失效。',
    tryOther: '扫了打不开？换个地址试试：',
    devicesHeading: '已配对的设备',
    devicesHint: '手机丢了或者换了，在这里移除，它就再也打不开了。',
    helpHeading: '打不开？',
    help: [
      '第一次打开开关时 Windows 会问要不要允许联网 —— 选<b>允许</b>，<b>「专用网络」和「公用网络」都勾上</b>。Windows 11 常把家里的 WiFi 也标成「公用网络」，只勾专用的话手机照样连不上。',
      '当时点了「取消」、或者只勾了一个：到 Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙 → 更改设置，找到「家庭管家」，两个框都勾上。',
      '电脑睡眠或者关掉了这个软件，手机就连不上。',
      '公司、酒店、商场的 WiFi 常常不让设备之间互相访问，那种网络下用不了；家里的路由器一般没问题。',
      '出了家门、用手机流量是连不上的 —— 只在同一个 WiFi 里有效。',
    ],
    off: '关着。同一个 WiFi 下谁都连不进来。',
    on: '开着，端口 {port}。只有配对过的设备能打开。',
    opening: '正在打开…',
    closing: '正在关闭…',
    pairedAt: '配对于 {a} · 最近用过 {b}',
    remove: '移除',
    dateFmt: '{m}月{d}日 {hh}:{mm}',
  },
  en: {
    lang: 'en',
    title: 'Phone access',
    loading: 'Loading…',
    toggleHint: 'Let paired phones on the same Wi-Fi connect',
    pairHeading: 'Pair a phone',
    step1: 'Connect the phone to <b>the same Wi-Fi as this computer</b>',
    step2: 'Scan the QR code on the left with the phone’s camera',
    step3: 'Once it opens, use “Add to Home Screen” in the browser so it opens like an app',
    oneUse: 'Each QR code works once. A new one appears after scanning, so you can pair the next phone.',
    expiresIn: ' This one expires in {n} min.',
    tryOther: 'Scanned but it won’t open? Try another address:',
    devicesHeading: 'Paired devices',
    devicesHint: 'Lost or replaced a phone? Remove it here and it can’t get in anymore.',
    helpHeading: 'Can’t connect?',
    help: [
      'The first time you turn this on, Windows asks whether to allow network access — choose <b>Allow</b> and tick <b>both “Private” and “Public” networks</b>. Windows 11 often marks home Wi-Fi as “Public”, so ticking only Private won’t work.',
      'If you clicked “Cancel” or ticked only one: go to Windows Security → Firewall & network protection → Allow an app through firewall → Change settings, find “Household Steward” and tick both boxes.',
      'If the computer is asleep or the app is closed, the phone can’t connect.',
      'Office, hotel and mall Wi-Fi often blocks devices from talking to each other, so it won’t work there; home routers are usually fine.',
      'It doesn’t work over mobile data or away from home — only on the same Wi-Fi.',
    ],
    off: 'Off. Nobody on the Wi-Fi can connect.',
    on: 'On, port {port}. Only paired devices can open it.',
    opening: 'Turning on…',
    closing: 'Turning off…',
    pairedAt: 'Paired {a} · last used {b}',
    remove: 'Remove',
    dateFmt: '{mon} {d}, {hh}:{mm}',
  },
};

let current = 'zh';

function fromSystem(sysLocale) {
  return /^zh/i.test(sysLocale || '') ? 'zh' : 'en';
}

function setLocale(l) {
  const next = l === 'en' ? 'en' : 'zh';
  const changed = next !== current;
  current = next;
  return changed;
}

function getLocale() {
  return current;
}

function tr(key, vars) {
  let s = STR[current][key] ?? STR.zh[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

function lanUi() {
  return LAN_UI[current];
}

module.exports = { fromSystem, setLocale, getLocale, tr, lanUi };
