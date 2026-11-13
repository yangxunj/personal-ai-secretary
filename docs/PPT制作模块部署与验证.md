# PPT 制作模块：首期部署与验证

本栏目连接单独运行的 Banana Slides 后端。秘书平台只保存连接配置；项目、大纲、页面图片及导出文件保存在独立后端的数据库和文件卷中，与已有“知识幻灯片”、秘书数据库及其他 Banana Slides 实例分开。当前只提供网页和现有桌面应用使用的栏目，未把 Python 服务打进 Windows 安装包，也未接入聊天 Agent 或 Android APK。

## 运行独立后端

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
