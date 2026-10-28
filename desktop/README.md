# 桌面端

把仓库根目录那个 Next 应用包成一个 Windows 桌面软件。**数据全部在使用者自己
的电脑上** —— 开发者没有任何访问路径。

这份讲怎么构建和发布，以及桌面端特有的几件事。应用本身的设计见
[`docs/开发笔记.md`](../docs/开发笔记.md)。

当前预发布版为 [`0.6.0-beta.3`](../docs/releases/v0.6.0-beta.3.md)：新安装默认内置 Pi + DeepSeek，交付搜索、文件原文、长对话与标题优化，并暂时隐藏阿里云预设和语音 UI。已有数据库、配置和会话保留。

Gmail 桌面试点见 [使用与隐私说明](../docs/Gmail桌面试点.md)。官方测试包内置 Desktop OAuth 应用参数，可直接点击连接；Google 应用仍处于 Testing，仅测试名单中的账号可授权。自备配置保留在高级设置。构建时自动准备并校验 GWS v0.22.5 Windows x64 工具及其 Apache-2.0 LICENSE；邮箱令牌、Cloud CLI 登录与模型密钥禁止打包。内置应用参数可被提取，不是保密的服务端密钥。

v0.5.0 的安装版、ZIP 与单文件免安装版均包含录音输入、回答朗读、连续语音和实时语音。
在设置页分别配置阿里云语音服务；音频或朗读正文会发送给对应云端服务，选择本机 Codex 也一样。
实时模式默认 Flash，支持插话与后台业务结果播报，长连接仍可能偶发中断。
手机录音需要 HTTPS，普通 HTTP 局域网网关不保证手机语音可用。详见
[v0.5.0 发布说明](../docs/releases/v0.5.0.md) 与 [实时语音文档](../docs/实时语音对话.md)。

## 形状

```
家庭管家.exe (Electron 主进程)
   │
   ├── 起一个子进程：Electron 自带的 Node 跑 runtime/server.js
   │      只听 127.0.0.1:<系统随机分配的端口>
   │
   └── 开一个窗口指向它
```

**没有额外的 Node 运行时。** `ELECTRON_RUN_AS_NODE=1` 让 Electron 自己的
二进制当纯 Node 用，省掉一整份运行时。

数据目录里三样东西：

| | |
| --- | --- |
| `secretary.db` | SQLite，第一次启动时从安装包里的模板复制 |
| `uploads/` | 上传的原件 |
| `backups/` | 备份 |

## 三种发行形式

`npm run dist` 一次出三个：

| 产物 | 大小 | 数据放哪 | 什么时候用 |
| --- | --- | --- | --- |
| `家庭管家 Setup <版本>.exe` | 131 MB | `%APPDATA%\家庭管家\data\` | **默认推荐**。装一次，开始菜单和桌面有图标 |
| `家庭管家-<版本>-win.zip` | 181 MB | 解压目录里 `data\` | 免安装。解压即用，拷到 U 盘能带走 |
| `家庭管家-免安装-<版本>.exe` | 131 MB | exe 同目录 `data\` | 单文件免安装。每次启动都要解压到临时目录，冷启动慢，通常优先用 ZIP |

### 数据落点是怎么判断的

按可靠性排序，见 `main.js` 的 `portableBase()`：

1. **`PORTABLE_EXECUTABLE_DIR`** —— electron-builder 的单文件免安装版会设这个
2. **同目录下有没有 `Uninstall *.exe`** —— NSIS 安装时会往安装目录写一个，解压
   出来的绿色版没有。这是区分"装过"和"解压的"最直接的证据，比猜路径
   （Program Files？LocalAppData？用户自己改过？）可靠
3. **目录写不写得进去** —— 兜底，只读位置退回 `%APPDATA%`

**装过的版本绝不能把数据放安装目录** —— 卸载会把整个目录删掉。

### 免安装版是真的不留痕

只改我们自己的 `data/` 是不够的：Chromium 的 Cookies、缓存、GPU 数据默认还写在
`%APPDATA%\家庭管家` 下。所以免安装模式下 `app.setPath('userData', …)` 把
Electron 自己的目录也搬到 exe 旁边（`appdata/`）。

实测过：绿色版跑完，`%APPDATA%` 下什么都没有。

⚠ `setPath` 必须在 app ready 之前调用，所以那段代码在模块顶层，别往函数里挪。

传到 GitHub Releases 时改成英文文件名（`personal-ai-secretary-Setup-<版本>.exe`、
`-<版本>-win.zip`、`-portable-<版本>.exe`）—— 附件名里的中文和空格在 GitHub
上会被改写，下载链接也难看，英文名最稳。

```bash
gh release create v<版本> --title "<版本> …" --notes-file notes.md <三个改好名的文件>
```

## 构建

```bash
cd desktop
npm install            # 只要一次
npm run dist           # → dist/家庭管家 Setup <版本>.exe（不带 key）
```

`npm run dist` 会先跑 `scripts/prepare.mjs`，它干五件事：构建 → 剥密钥 →
**体检** → 补静态资源和 Prisma 引擎 → 生成模板库和模型配置。

本地试跑（不打包）：

```bash
npm start              # prepare + 开窗口
npm run dev            # 只开窗口，用上次的产物
```

## 六个已经踩过的坑

**1. `.env` 会被 Next 跟踪进产物。**

`output: 'standalone'` 的文件跟踪把根目录的 `.env` 一起复制进去了 —— 里面有
`AI_API_KEY`、`APP_PASSWORD_HASH`、`SESSION_SECRET`、`BACKUP_PASSPHRASE`。
这份产物是要**发给别人**的。`prepare.mjs` 里有一步专门剥掉它，别删。

**2. `outputFileTracingRoot` 删了就可能把上级目录的文件打进安装包。**

项目要是放在另一个项目的子目录里、父目录也有 package-lock.json，Next 会把
workspace root 推断到父目录 —— 父目录里的文件就都进了跟踪范围，被复制进
`.next/standalone/`，然后被打进 `.exe`。这个项目最初就是这样差点把别的私人文件打包出去。

`next.config.mjs` 里那行钉死了根目录，`prepare.mjs` 里还有一道体检兜底
（顶层白名单 + 中文文件名扫描）。**体检报警就停下来查，别绕过去。**

**3. 产物目录不能叫 `app/`。**

electron-builder 有个约定：根目录下存在 `app/` 就把它当应用根目录，去找
`app/index.js`，报 `Application entry file does not exist`。所以叫 `runtime/`。

**4. Windows 上 Node 不让 spawn `.cmd`。**

Node 20 起的安全修复，`npm.cmd` / `npx.cmd` 直接 `EINVAL`。`prepare.mjs` 绕开
它们，用当前这个 node 去跑 `node_modules/next/dist/bin/next` 和
`node_modules/prisma/build/index.js`。

**5. standalone 不含静态资源。**

`.next/static` 和 `public/` 要自己补。少了这步页面出来是没样式的白板 ——
而且不报错，只是难看，很容易以为是 CSS 写坏了。

**6. `productName` 只写在 `build` 里不够。**

Electron 的 `app.getName()` 读的是 package.json **顶层**的 `productName`，
读不到才退回 `name`。只写在 `build.productName` 里的话，exe 和安装包都叫
「家庭管家」，但 `app.getPath('userData')` 是 `%APPDATA%\ai-secretary-desktop` ——
用户按文档去找数据目录会找不到。所以顶层写一份，`build` 里那份删掉，
保持一个来源。

## 关于 API key

公开构建 `prepare.mjs --no-key` 从根目录 `.env.example` 读取 `AI_BASE_URL/AI_MODEL`，
写入 `runtime/resources/ai.json` 作为默认值，避免混入开发机当前服务商配置。
新模板只有 `ai.backend=pi` 设置，业务表为空；已有用户数据库不会被模板覆盖。

`npm run dist` 带着 `--no-key`，**key 一律不打进去** —— 拿到安装包的人能把它抠出来。
使用者装好后在「设置」页填自己的 key，存在本机数据库里。

发布前对实际解压后的应用执行审计（路径按构建输出调整）：

```powershell
node scripts/audit-package.mjs --app=dist/win-unpacked/resources/app
```

审计检查公开默认配置、空业务模板、开发机环境文件中的密钥是否混入、Gmail Testing 客户端和 GWS 校验值。它不能代替客户端启动与升级验收。

只有打给自己家里人用、想让他们装完就能对话时，才手动跑不带 `--no-key` 的
`node scripts/prepare.mjs`，而且那个 key 最好单独申请、出事好吊销。
那样的安装包别往公开的地方传。

## 没有登录

Next 服务只听 127.0.0.1，没有网络侧的攻击面，所以 `ALLOW_INSECURE_LOCAL=true` +
`AUTH_ENABLED=false`（跟 Obsidian、VS Code 一个道理）。

## 手机访问（`lan.js`）

菜单「设置 → 用手机访问…」，**默认关**。打开后主进程另起一个 `0.0.0.0:8790`
（被占就顺延）的网关，**只放配对过的设备进来**，再原样转发给 127.0.0.1 上的 Next。
所以上面「没有登录」的前提没被推翻：Next 本身照旧只有本机连得上。

- **关卡为什么在主进程不在 middleware**：这里拿得到 socket 的真实对端地址；
  middleware 只能看 Host / X-Forwarded-For，局域网里谁都能伪造。
- **配对**：窗口里的二维码带一次性配对码（用一次就换、10 分钟作废），扫了发一张
  400 天的 `hs_device` cookie，`lan.json` 里只存哈希。设备能在窗口里移除。
- **开关和二维码只在本地小窗口里**（`lan.html` + `lan-preload.js`），不在 Next 的
  设置页 —— 那一页手机也打得开，放那儿的话配对过的手机就能自己发码、踢人。
  Next 设置页只放一句指路（看 `DESKTOP_APP` 环境变量）。
- **Host 头原样转发**：Next 的 Server Action 拿 Origin 跟 Host 比对，改了就全被当跨站。
- **状态**：`lan.json`，跟 `config.json` 同一层。上次开着，重启软件自动接着开。
- **防火墙是最大的坑**：Windows 11 常把家里网络标成「公用」，允许时只勾「专用」
  手机照样不通；点过「取消」会留下一条 Block 规则，之后不再弹。窗口里写了怎么修。
  本机自己连局域网 IP 不过防火墙，**所以本机测通了不代表手机能通**。
- 开发时 `HS_USER_DATA=<目录>` 换数据目录、`HS_OPEN_LAN=1` 启动即开窗口（自动化测试点不了原生菜单），打包后都不生效。

## 还没做的

| 缺什么 | 影响 |
| --- | --- |
| **自动更新** | 每次改动要重新下载安装。electron-updater 可以接 GitHub Releases |
| **代码签名** | 没签名，Windows SmartScreen 会拦一道「未知发布者」。要买证书才能去掉 |
| **备份** | `scripts/backup.mjs` 是命令行的，桌面端还没接上 —— 得做成「关闭时备份」或者菜单里一个按钮 |
| **mac / Linux** | 现在只出 win x64 |

## 改了 schema.prisma 之后

老用户的库**不会**跟着安装包升级：`template.db` 只在第一次启动、库还不存在时拷一份。
所以每次改表结构，都要在 `src/lib/schema-upgrade.ts` 里补一步幂等的 SQL ——
服务启动时（`src/instrumentation.ts`）会自动补上。漏了的话，少一列就是所有读那张表的
页面报错。SQL 照开发库上 `prisma db push` 生成的原样抄（`SELECT sql FROM sqlite_master …`）。
