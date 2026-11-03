# 安卓共用代码隔离试验

入口：[整体路线](../../docs/安卓与多端共用路线.md)、[首阶段实施计划](../../docs/安卓首阶段实施计划.md)。

M0/M1 本地最小链路完成：用户报告 `0.1.0-pilot` 所列手工测试全部通过。当前 `0.2.0-pilot` 新增编辑、SQLite 增量升级和版本保护，直接复用正式服务抽出的 `record-write.ts`；正式数据库、根目录依赖锁文件和用户资料未改动。

设备未连接开发机，继续由用户手工验收。[首包验收结果](../../docs/安卓首个试验包验收.md)、[第二版下载与覆盖升级步骤](../../docs/安卓第二版覆盖升级验收.md)、[技术决策](../../docs/安卓运行层技术决策.md)。M2 进行中，不把首包通过当成新版升级也已通过。

## 构建与验证

要求主仓库已有锁定依赖、Node 24、JDK 17、Android SDK platform/build-tools 34。设置 `JAVA_HOME`，在仓库根目录执行：

```powershell
./experiments/android-shared/build.ps1 -SdkPath '<Android SDK 的绝对路径>'
```

脚本默认使用工程的 Gradle 8.9 Wrapper；需要时可显式传入 `-NodePath`、`-GradlePath`。首次构建会从官方仓库下载依赖；依赖齐备后可加 `-Offline`。本轮已用 Gradle 8.9 补齐在线依赖，并使用 Wrapper 完成最终离线构建。

脚本执行共享网页构建、七项 Node/浏览器规则测试，并生成应用 APK 与设备测试 APK。交付 APK 在被忽略的 `artifacts/`，版本来自 `pilot-config.json`。不要将调试密钥、构建缓存、应用数据或本机 SDK 路径加入 Git。

设备自动验收（尚未运行）：

```powershell
./experiments/android-shared/android/gradlew.bat -p experiments/android-shared/android connectedDebugAndroidTest
```

该测试会启动独立试验应用，添加/修改合成书单，检查实际 WebView 规则与 Activity 重开后的记录；另在 Android SQLite 内存数据库验证旧表迁移保留内容。测试包已编译，未执行；不能替代旧 APK 覆盖安装或用户实际数据文件升级。

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

1. 共用 `schema.ts` 与 `record-write.ts`，包含字段校验、局部合并、版本/归档保护与标题/搜索文本准备；正式网页/Windows 服务与安卓从同一源码调用。
2. 首包的安卓本地保存、重开与进程恢复已获用户通过反馈；第二版的编辑和真实数据库升级待验。
3. 正式栏目服务 12 项集成测试（含 Pi）与 TypeScript 检查通过；下一步完成第二版实机升级，然后扩展共享应用服务及 AI 创建待办。

这比先搬全部页面更容易分清运行环境、数据库和业务逻辑各自的问题。候选路线与完整通过条件以首阶段计划为准。

## 环境与证据边界

工具链为 Node 24.19.0、JDK 17.0.20.1、Android SDK/build-tools 34、platform-tools 37.0.1、Gradle 8.9、AGP 8.5.2。两版实际构建与签名验证通过、签名证书相同；用户手工验收首包通过。ADB 没有连接设备，开发者设备自动测试尚未运行。

浏览器在独立 Edge/CDP 会话中检查了横竖屏、保存/编辑、版本冲突与保留草稿，截图已查看；存储使用合成替身。构建有 webpack 资源大小提示（第二版约 369 KiB，未压缩），当前是试验包，不作为正式性能验收。

APK 包含项目 AGPL 及 Zod MIT、AndroidX Apache 许可说明；不包含本机配置、用户资料、调试签名私钥或原生 `.so`。

试验使用合成记录与独立测试目录。后续如增加 APK、编译缓存或测试凭据，需要先添加精确忽略规则；本目录不是存放正式数据库或用户密钥的位置。
