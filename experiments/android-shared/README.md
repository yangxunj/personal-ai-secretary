# 安卓共用代码隔离试验

入口：[整体路线](../../docs/安卓与多端共用路线.md)、[首阶段实施计划](../../docs/安卓首阶段实施计划.md)。

M0/M1 完成，用户已报告 `0.1.0-pilot` 与 `0.2.0-pilot` 全部测试通过。当前 `0.3.0-pilot` 接入上游 Pi 循环、共用工具契约、安卓工具回执和原生 DeepSeek 单轮传输；正式数据库、根目录依赖锁文件和用户资料未改动。

设备未连接开发机，继续由用户手工验收。[首包结果](../../docs/安卓首个试验包验收.md)、[第二版结果](../../docs/安卓第二版覆盖升级验收.md)、[第三版下载与验收](../../docs/安卓第三版Pi与模型连接验收.md)、[技术决策](../../docs/安卓运行层技术决策.md)。M2 进行中，第三版的实际 Pi/模型结果不能沿用第二版的通过状态。

## 构建与验证

要求主仓库已有锁定依赖、Node 24、JDK 17、Android SDK platform/build-tools 34。设置 `JAVA_HOME`，在仓库根目录执行：

```powershell
./experiments/android-shared/build.ps1 -SdkPath '<Android SDK 的绝对路径>'
```

脚本默认使用工程的 Gradle 8.9 Wrapper；需要时可显式传入 `-NodePath`、`-GradlePath`。首次构建会从官方仓库下载依赖；依赖齐备后可加 `-Offline`。本轮已用 Gradle 8.9 补齐在线依赖，并使用 Wrapper 完成最终离线构建。

脚本执行共享网页构建、12 项共用/Pi 检查，并生成应用 APK 与设备测试 APK。交付 APK 在被忽略的 `artifacts/`，版本来自 `pilot-config.json`。不要将调试密钥、构建缓存、应用数据或本机 SDK 路径加入 Git。

设备自动验收（尚未运行）：

```powershell
./experiments/android-shared/android/gradlew.bat -p experiments/android-shared/android connectedDebugAndroidTest
```

设备测试会添加/修改合成书单、检查 WebView 和 Activity 重开，在 Android SQLite 验证迁移及工具回执去重。测试包已编译，未执行；不能替代本轮手工验收。Android Lint 另可通过 `gradlew.bat -p experiments/android-shared/android :app:lintDebug` 运行，本轮无错误，仅剩启用 JS 的预期提醒。

桌面布局预览可运行 `node experiments/android-shared/preview-server.mjs`，仅监听 `127.0.0.1:8465`。普通浏览器没有原生桥接，保存按钮默认禁用；开发验收用合成替身注入，不将替身打进 APK。

## 重跑盘点

在仓库根目录运行：

```powershell
node experiments/android-shared/inventory.mjs
```

输出 JSON 至标准输出。已保存的 [inventory.json](inventory.json) 是基于 `5657662` 主应用源码的 2026-11-03 快照。后续修改源码后需要重跑，不能把旧快照当成现状。工具自身依赖根目录已安装的 TypeScript，不下载包、不连接模型、不读取 `.env` 或 `data/`，不执行扫描到的源码。

## 初始结果

扫描 217 个 Git 跟踪的 `src/`、`desktop/` 代码文件，排除声明文件；统计存在对应直接运行时导入的文件数量，同一文件可出现在多个分类。

| 依赖分类 | 文件数 | 迁移意义 |
| --- | ---: | --- |
| Next.js | 57 | 路由、服务端入口和界面存在框架依赖，不能直接整体静态打包 |
| Electron | 3 | 桌面窗口、Gmail、局域网窗口相关入口需要平台替代 |
| Node 内置模块 | 35 | 文件、进程、加密等需要运行时支持或适配 |
| Prisma 运行时 | 1 | 入口集中在 `src/lib/db.ts`，但依赖它的服务仍间接依赖 Prisma |
| 原生/文档依赖候选 | 4 | `sharp`、`@napi-rs/canvas` 及 `unpdf` 调用链需实测；不表示三者都直接含原生二进制 |
| Pi SDK | 1 | `src/lib/pi/runtime.mjs` 需要进一步检查 SDK 的传递依赖 |

工具识别静态 import/export、字面量动态 import 和 require，并跳过类型导入。没有分析传递依赖、Node 全局变量、计算导入、包内二进制或设备兼容性。因此“没有命中”不代表模块已经可在安卓运行。

## 本轮完成与后续链路

1. 共用 `schema.ts`、`record-write.ts` 和四项 `tool-contracts.ts`。正式网页/Windows 与安卓没有复制参数和字段规则；正式服务的事务、引用校验与审计仍保留。
2. 首包本地保存/重开/进程恢复与第二版真实覆盖升级/编辑均获用户通过反馈。
3. 第三版直接调用 Pi 1.4.0 上游 `runAgentLoop`，窄入口只重导出纯 Pi AI 工具；TypeBox 使用官方解释模式，不开放动态代码执行。没有迁移完整 coding-agent 的持久会话或压缩。
4. SQLite 版本3新增工具回执，与对应记录写入同事务提交。单轮最多4次模型请求/8次工具操作；默认固定演练免费，真实 DeepSeek 仅在用户选中并发送时调用。
5. 原生密钥由 Android Keystore 加密，不向网页暴露；原生网络固定 DeepSeek HTTPS，不允许动态 URL。WebView 的网页连接仍由 CSP 阻止。没有在开发机读取真实密钥或调用真实收费模型。

这比先搬全部页面更容易分清运行环境、数据库和业务逻辑各自的问题。候选路线与完整通过条件以首阶段计划为准。

## 环境与证据边界

工具链为 Node 24.19.0、JDK 17.0.20.1、Android SDK/build-tools 34、platform-tools 37.0.1、Gradle 8.9、AGP 8.5.2。三版实际构建和签名验证通过、签名证书相同；用户手工验收前两版通过。ADB 没有连接设备，开发者设备自动测试尚未运行。第三版需要支持 `structuredClone` 的系统 WebView，过旧时提示更新。

浏览器在独立 Edge/CDP 会话中检查了横竖屏、保存/编辑、版本冲突、Pi 固定演练、模型错误/取消、所选配置可见及草稿保留，截图已查看；原生存储/网络使用合成替身。构建有 webpack 资源大小提示（第三版约 1.06 MiB，未压缩），当前不是正式性能验收。

APK 包含项目 AGPL、Zod/Pi/TypeBox MIT、AndroidX Apache 许可说明；不包含本机配置、用户资料、调试签名私钥或原生 `.so`。许可原文 `licenses/pi-MIT.txt` 来自上游公开仓库；真正模型请求、Keystore 保存及设备回执执行仍待第三版验收。

试验使用合成记录与独立测试目录。后续如增加 APK、编译缓存或测试凭据，需要先添加精确忽略规则；本目录不是存放正式数据库或用户密钥的位置。
