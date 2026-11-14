# PPT 制作模块：首期部署与验证

本栏目连接单独运行的 Banana Slides 后端。引擎源码现已按固定版本纳入本项目；项目、大纲、页面图片及导出文件保存在独立后端的数据目录中，与已有“知识幻灯片”、秘书数据库及其他 Banana Slides 实例分开。当前先验证网页部署，尚未把 Python 服务打进 Windows 安装包，也未接入聊天 Agent 或 Android APK。

## 项目内引擎：隔离部署

`integrations/banana-slides/engine/` 包含固定的引擎源码、许可证及依赖锁，来源见同目录的 `ENGINE-SOURCE.md`。在项目根目录的 `.env` 里按 `.env.example` 设置 `SECRETARY_PPT_BACKEND_URL` 和可选的 `PPT_TEXT_*`、`PPT_IMAGE_*` 初始配置。

在秘书平台“设置 → AI 设置 → PPT 制作模型”里填入 OpenRouter API Key 后，项目内引擎会在每次发起生成前，自动使用秘书平台现有的 Pi 对话 API 配置（地址、模型和密钥，例如 DeepSeek）生成大纲和页面描述，使用 OpenRouter 的 `meta/muse-image` 生成图片。Codex 对话的登录不会自动变成 Pi 的 API 配置；若使用 Codex 对话，仍需单独在 Pi 模型配置中准备文字 API。保存设置不会发起模型调用或验证余额；空密钥栏保留已有设置。

OpenRouter 密钥与现有对话 API 密钥一样保存在秘书数据库中，沿用项目现有的数据库文件访问保护；它们不会返回到设置页或写入 PPT 引擎数据库。生成前，秘书平台先通过 `data/ppt-engine/instance/.secretary-control-token` 与项目内引擎相互校验，再通过本机接口将配置放入引擎进程内存；引擎重启后会在下一次生成时重新应用。引擎有任务正在运行时，修改后的配置会等待任务结束，避免影响正在运行的任务。请保护数据目录的系统访问权限；控制文件不纳入 PPT 备份。

设置页的配置只应用于项目内托管引擎，不会改写原有 Banana Slides 服务。若当前仍连接旧服务，保存后需要启动并切换到托管引擎；如果还没有在设置页配置 OpenRouter，则沿用现有引擎配置。图片理解组件默认使用同一套文字模型配置；未来若使用图片理解功能，文字模型需支持视觉输入。

安装 Docker 后，在秘书平台项目根目录启动：

```powershell
docker compose -p secretary-ppt-managed -f integrations/banana-slides/compose.managed.yml up -d --build
```

该命令只从项目内 `engine/` 构建，不依赖旁边的 Banana Slides 源码目录。默认只在本机 `127.0.0.1:15398` 监听，数据保存在本项目 `data/ppt-engine/instance` 和 `data/ppt-engine/uploads`，不读取已有服务的数据库。`SECRETARY_PPT_BACKEND_URL` 应设为 `http://127.0.0.1:15398`，修改后重启秘书平台。要自定义 `SECRETARY_PPT_ENGINE_DATA_DIR`，请使用绝对路径，并在备份和部署时使用同一配置；自定义 `SECRETARY_PPT_ENGINE_PORT` 时也要同步修改后端地址。

此方式仍需要单独启动一个 Docker 后端，是把源码、配置和数据纳入项目的阶段性部署方式；尚不等于 Windows 安装包自动管理引擎。原有手机预览仍连接已有 PPT 服务，切换到本项目内引擎前应另行配置和验收；不会自动导入或迁移旧项目。

## 备份和恢复

现有 `npm run backup` 在检测到 `data/ppt-engine` 存在时，会将其 SQLite 一致性快照和 `uploads/` 一起打包进原有备份。为防止生成中出现数据库与图片不一致，**必须先等待 PPT 任务结束并停止托管引擎**，备份完成后再启动：

```powershell
docker compose -p secretary-ppt-managed -f integrations/banana-slides/compose.managed.yml stop
npm run backup
docker compose -p secretary-ppt-managed -f integrations/banana-slides/compose.managed.yml start
```

当端口仍被占用、PPT 数据不完整或数据库中仍有未结束任务时，备份会报错而不是跳过 PPT。备份期间不要启动引擎；关闭前的异常中断可能留下未结束任务记录，需先启动引擎处理该状态再停止。备份可能包含 PPT 数据库中保存的敏感配置，使用默认加密方式并妥善保管口令，不要使用明文备份存放正式数据。

`node scripts/restore.mjs` 只解包到新目录，不会自动覆盖数据。核对后，关闭秘书平台和 PPT 引擎，把恢复出的 `ppt-engine/` 中 `instance` 和 `uploads` 一起放回对应数据目录，再启动引擎。模型配置文件 `.env` 不随备份复制，须另行安全保存和恢复。旧 Docker 命名卷中的数据及其他 Banana Slides 实例不属于此备份范围。

## 原有独立后端方式

需要 Docker Desktop、Banana Slides 源码，以及兼容该版本的文本模型和图片生成模型。首次在 PowerShell 中以源码根目录构建专用镜像（路径按实际情况修改）：

```powershell
docker build -t secretary-banana-slides:local -f C:\path\to\banana-slides\backend\Dockerfile C:\path\to\banana-slides
```

复制 `integrations/banana-slides/banana.env.example` 为同目录下的 `banana.env`，参照所用 Banana Slides 版本的 `.env.example` 填写文本、图片模型与密钥。模型服务有费用时，以供应商计费为准。`banana.env` 已忽略，请勿提交或分享；不要复制已有项目的整个配置或数据目录。文件中的示例字段是否适用，取决于所构建的 Banana Slides 版本和模型供应商。

在秘书平台根目录执行：

```powershell
docker compose -p secretary-ppt -f integrations/banana-slides/compose.yml up -d
```

服务只绑定本机 `127.0.0.1:15392`，使用专用 Docker 数据卷；不要用 Banana Slides 原项目的默认 compose，否则可能连接其原有数据。端口冲突时，在启动 compose 前设置 `SECRETARY_PPT_PORT`，同时修改下面的地址。当前适配器不使用 Banana 的 `ACCESS_CODE`，请不要在这个独立实例启用它。即使仅绑定本机，其他本机进程仍能访问该服务；不要把端口直接开放到公网。

在秘书平台进程的环境中设置 `SECRETARY_PPT_BACKEND_URL=http://127.0.0.1:15392` 后重启秘书平台。服务地址仅允许本机 HTTP 地址，未配置时栏目会明确提示。远程部署时应在秘书平台所在的机器或网络命名空间中运行后端；不要将无鉴权的 Banana API 暴露给用户。秘书平台应开启其现有登录保护。

## 验收

1. 打开侧边栏的“PPT 制作”，填写教学主题、页数要求及视觉风格，点击“创建项目”。
2. 依次生成大纲、页面描述和图片。大纲是同步请求，耗时可能较长，请保持页面打开；描述和图片为后台任务，刷新后可在同一浏览器恢复进度。服务重启可能中断正在运行的任务。
3. 确认每页图片已显示，再点击“导出 PPTX”，打开下载的文件检查页数与画面。普通导出以整页图片组成，文字不能作为独立文本编辑。

失败时检查独立后端及其模型配置，避免在任务仍在运行时重复发起生成。当前按钮会重新生成整个阶段；页面尚不支持编辑、删除项目或配置模型，也不能保证图片中的文字完全准确。生成结果应由教师检查。

测试环境使用合成图片验证预览和导出，不能证明实际模型调用成功；首次部署需按上述步骤完成真实生图验收。更新后端时请先备份其专用数据库卷和图片卷，不要以删除 Docker 卷的方式常规停服务。

## 2026-11-14 本机真实联调与后续方向

经用户同意，在本机已有的 Banana Slides 测试服务中新增了一个明确标记的单页水循环项目。秘书栏目成功创建项目并通过文字模型生成一页大纲和页面描述；图片任务返回完成但失败数为 1、没有图片。经检查，运行中的测试镜像包含 Muse 专用接口代码；其向 OpenRouter 图片接口发出 HTTPS 请求时发生 SSL 异常（record layer failure），具体原因仍待查明。没有取得真实图片或真实图片 PPTX，故端到端生图验收尚未通过。

只读核对时，当前宿主机命令执行环境存在 HTTP 和 HTTPS 代理环境变量，而现有 PPT 测试容器没有设置相应变量；这只是连接诊断线索，尚不能证明它就是失败原因。排查代理时不要在文档、日志或版本库中记录代理凭据，也不要擅自更改已有服务的配置。

在本机另行启动了 `secretary-ppt` 独立容器，使用单独数据卷，初始项目为空；它尚未配置模型凭据，不能用于真实生成。容器与既有 Banana Slides 实例数据不互通。当前本机使用已有 `banana-slides-muse-test-backend:cc2f989d` 镜像；今后重新运行 compose 时需指定 `BANANA_SLIDES_IMAGE`，或者按照上文构建默认名称的镜像。

这一阶段用 HTTP 对接本机独立后端，目的是先验证工作流和模块边界。最终目标是把 PPT 引擎及其依赖纳入秘书平台的统一安装、启动和备份，并按需要进一步抽取生成逻辑到平台进程；文字和图片生成继续调用外部 AI 服务。本地部署 AI 模型或完全离线运行不属于当前目标。
