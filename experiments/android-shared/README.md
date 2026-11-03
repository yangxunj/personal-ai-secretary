# 安卓共用代码隔离试验

入口：[整体路线](../../docs/安卓与多端共用路线.md)、[首阶段实施计划](../../docs/安卓首阶段实施计划.md)。

已完成 M0，并构建首个 `0.1.0-pilot` APK：直接引用现有栏目规则，通过安卓原生适配器保存到独立 SQLite 数据库。主应用正式业务代码、根目录依赖锁文件和用户数据均未改动。

设备尚未连接；用户选择手工安装测试包。[下载与验收步骤](../../docs/安卓首个试验包验收.md)、[技术决策与官方依据](../../docs/安卓运行层技术决策.md)。M1/M2 保持部分完成，不能将构建和浏览器验证当成安卓实机通过。

## 构建与验证

要求主仓库已有锁定依赖、Node 24、JDK 17、Android SDK platform/build-tools 34。设置 `JAVA_HOME`，在仓库根目录执行：

```powershell
./experiments/android-shared/build.ps1 -SdkPath '<Android SDK 的绝对路径>'
```

脚本默认使用工程的 Gradle 8.9 Wrapper；需要时可显式传入 `-NodePath`、`-GradlePath`。首次构建会从官方仓库下载依赖；依赖齐备后可加 `-Offline`。本轮已用 Gradle 8.9 补齐在线依赖，并使用 Wrapper 完成最终离线构建。

脚本执行共享网页构建、五项 Node/浏览器规则测试，并生成应用 APK 与设备测试 APK。交付 APK 在被忽略的 `artifacts/`，不要将调试密钥、构建缓存、应用数据或本机 SDK 路径加入 Git。

设备自动验收（尚未运行）：

```powershell
./experiments/android-shared/android/gradlew.bat -p experiments/android-shared/android connectedDebugAndroidTest
```

该测试会启动独立试验应用，添加一条合成书单，检查实际 WebView 中的规则及 Activity 重开后的记录。它不替代进程强停、飞行模式、覆盖升级和真实用户操作验收。

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

1. 已复用现有 `src/lib/collections/schema.ts`，没有复制规则；Node 与浏览器执行结果及打包源码哈希检查通过。
2. 已实现栏目输入 → 共用校验 → 原生 SQLite → 列表读取；真正安卓执行、重开读取和进程恢复待手工验收。
3. 下一步在设备结果基础上补齐覆盖升级与一次共享规则更新传播，再扩展共享应用服务及 AI 创建待办。

这比先搬全部页面更容易分清运行环境、数据库和业务逻辑各自的问题。候选路线与完整通过条件以首阶段计划为准。

## 环境与证据边界

已执行 Node 版本检查（v24.19.0）和 Java 版本检查（17.0.20.1）；Android SDK platform android-34、build-tools 34.0.0、platform-tools 37.0.1、Gradle 8.9、AGP 8.5.2。实际构建与 APK 签名验证通过；ADB 已启动并查询，没有已连接设备。没有运行设备测试，也没有宣布平板可用。

浏览器在独立 Edge/CDP 会话中检查了横竖屏、成功保存和失败保留草稿，截图已查看；存储使用合成替身。构建有 webpack 资源大小提示（约 365 KiB，未压缩），当前是试验包，不作为正式性能验收。

APK 包含项目 AGPL 及 Zod MIT、AndroidX Apache 许可说明；不包含本机配置、用户资料、调试签名私钥或原生 `.so`。

试验使用合成记录与独立测试目录。后续如增加 APK、编译缓存或测试凭据，需要先添加精确忽略规则；本目录不是存放正式数据库或用户密钥的位置。
