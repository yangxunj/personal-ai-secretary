# 安卓共用代码隔离试验

入口：[整体路线](../../docs/安卓与多端共用路线.md)、[首阶段实施计划](../../docs/安卓首阶段实施计划.md)。

M0/M1完成；前四版分别获用户通过反馈。当前 `0.5.0-pilot` 在共用任务/栏目工具上增加多轮上下文、会话/草稿持久化与中断恢复。正式数据库、根目录依赖锁和用户资料未改动。

设备未连接开发机，继续由用户手工验收。[首包](../../docs/安卓首个试验包验收.md)、[第二版](../../docs/安卓第二版覆盖升级验收.md)、[第三版](../../docs/安卓第三版Pi与模型连接验收.md)、[第四版](../../docs/安卓第四版待办验收.md)、[第五版下载与验收](../../docs/安卓第五版多轮会话验收.md)。M2进行中，第五版真实多轮/恢复待验，不用前版反馈替代。

## 构建与验证

要求主仓库已有锁定依赖、Node 24、JDK 17、Android SDK platform/build-tools 34。设置 `JAVA_HOME`，在仓库根目录执行：

```powershell
./experiments/android-shared/build.ps1 -SdkPath '<Android SDK 的绝对路径>'
```

脚本默认使用工程的 Gradle 8.9 Wrapper；需要时可显式传入 `-NodePath`、`-GradlePath`。首次构建会从官方仓库下载依赖；依赖齐备后可加 `-Offline`。本轮已用 Gradle 8.9 补齐在线依赖，并使用 Wrapper 完成最终离线构建。

脚本执行共享网页构建、20项共用/Pi检查，生成应用APK与设备测试APK。本轮另通过共享依赖检查2项、正式Node Pi SDK回归6项与TypeScript，共28项相关检查。交付APK在被忽略的 `artifacts/`，版本来自 `pilot-config.json`；调试密钥、缓存、应用数据和本机SDK路径不加入Git。

设备自动验收（尚未运行）：

```powershell
./experiments/android-shared/android/gradlew.bat -p experiments/android-shared/android connectedDebugAndroidTest
```

设备测试会添加/修改合成书单，检查WebView/Activity重开、SQLite迁移/回执、任务隔离/局部更新，以及会话4→5迁移和版本冲突。测试包已编译未执行，不能替代手工验收。Lint可通过 `gradlew.bat -p experiments/android-shared/android :app:lintDebug` 运行，本轮无错误，仅剩启用JS提醒。

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

1. 书单共用 `schema.ts`、`record-write.ts` 和四项 `tool-contracts.ts`；待办共用 `tasks/contracts.ts`/`policy.ts`。正式服务的事务、引用校验、任务专属范围和审计仍保留。
2. 首包本地保存/重开/进程恢复与第二版真实覆盖升级/编辑均获用户通过反馈。
3. 直接调用Pi 1.4.0上游 `runAgentLoop`，窄入口只重导出纯Pi AI工具；TypeBox使用官方解释模式。第五版增加SQLite多轮快照和恢复，未移植完整coding-agent文件会话或自动压缩。
4. SQLite版本3新增回执，版本4新增任务表，版本5新增会话表；任务/书单与回执同事务。每轮最多4次模型请求/8次工具操作，固定演练免费；会话每种模式最多20个、每个最多40轮，无删除/导出。
5. 原生密钥由 Android Keystore 加密，网络固定 DeepSeek HTTPS。用户报告第三版模型真实新增书单成功，第四版交付清单全部通过，包括真实待办新增/查询/完成、旧书单与原要求/日期、重开保留。开发机未读取密钥或调用收费接口；未单独反馈的强停/取消/后台与密钥恢复保持待验。

这比先搬全部页面更容易分清运行环境、数据库和业务逻辑各自的问题。候选路线与完整通过条件以首阶段计划为准。

## 环境与证据边界

工具链为Node 24.19.0、JDK 17.0.20.1、Android SDK/build-tools 34、platform-tools 37.0.1、Gradle 8.9、AGP 8.5.2。第五版构建与签名通过，证书同第四版；开发者没有设备测试执行日志，需要支持 `structuredClone` 的WebView。

浏览器在独立 Edge/CDP 会话验证任务创建/完成/筛选、原文/日期保留、Pi 固定演练和模型响应替身闭环，横竖屏截图已查看；原生存储/网络为合成替身，浏览器日期选择手势未自动化通过。用户的后续设备通过反馈另见第四版验收，不将其写成开发者自动测试。构建有 webpack 资源大小提示（第四版约 1.07 MiB，未压缩），不是正式性能验收。

## 共用代码构建检查

在根目录运行 `npm run check:shared`；依赖现有TypeScript，不联网。`build-web.mjs`自动执行，失败停止构建。入口包含栏目schema/写入策略/工具契约、待办契约/策略、Pi会话协议/上下文估算。检查擦除类型导入后的运行依赖，追踪本地import/export、`@/`别名和字面量动态import/require；只允许src内源码与审查过的zod入口，拒绝平台包、未审查包、无法解析/计算导入。构建清单保存实际闭包。

这不是任意 JavaScript 的沙箱或第三方包内容审计：不分析运行时全局变量、别名 require 或包内部依赖；Webpack 的平台依赖拦截仍保留。新增共享入口或允许包必须显式修改检查清单并重新审查。

重跑：`node --test scripts/check-shared-core.test.mjs experiments/android-shared/shared-rules.test.mjs`（先执行 `node experiments/android-shared/build-web.mjs`）。当前22项通过，覆盖依赖故障注入、两端任务策略对照、历史工具配对、多轮与中断恢复；清单包含任务/会话协议/上下文估算哈希，旧bundle与新源码不一致会拒绝通过。正式Node SDK另跑 `node --test scripts/pi-runtime.test.mjs`（6项）。

APK 包含项目 AGPL、Zod/Pi/TypeBox MIT、AndroidX Apache 许可说明，不包含本机配置、用户资料、签名私钥、浏览器 fixture 或原生 `.so`。完整会话/最终共用 React UI 仍为后续工作。

试验使用合成记录与独立测试目录。后续如增加 APK、编译缓存或测试凭据，需要先添加精确忽略规则；本目录不是存放正式数据库或用户密钥的位置。
