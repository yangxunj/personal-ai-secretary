# PPT 引擎源码来源

`engine/` 是 Banana Slides 后端的固定版本快照，来源于 [用户维护的 Banana Slides 分支](https://github.com/yangxunjiehk/banana-slides) 的本机 Git 仓库提交 `cc2f989d4c0cdeb421d5e2bdd98e8fc3a1ac3fb3`（`feat: support OpenRouter Muse slide image editing`）；该分支的上游为 [Anionex/banana-slides](https://github.com/Anionex/banana-slides)。该版本保留上游 AGPL-3.0 许可证、README、Python 依赖清单和锁文件、后端及上游测试，以及后端模型测试所需的 `assets/test_img.png`。未引入前端、产品宣传素材、数据库、上传文件、本机配置或历史运行日志（包括上游被跟踪的日志文件）。

2026-11-14 对照已由用户实测生图和导出的 `banana-muse-local-backend-1` 容器，快照中 144 个运行时源码、迁移、配置和字体文件的 SHA-256 与容器内文件一致。该容器还以外部启动脚本加载它自己的环境配置并启动引擎；这里没有复制该脚本、模型配置或凭据，也没有迁移它的数据库和作品。

项目内源码独立构建的镜像已在隔离目录验证创建项目、重启持久化、图片读取及 PPTX 导出；另用本地模拟模型服务验证大纲、描述、图片、导出的完整接口流程。上游 Muse 测试使用模拟请求通过。这些检查不代表新镜像已经完成真实模型生成验收。

上游更新应通过明确的版本更新和对照验证引入；用户数据和配置不得混入源码快照。产品发行时需同时保留上游版权和许可证，并针对最终的分发方式复核 AGPL 义务。

本项目额外添加了 `engine/secretary_runtime_control.py`，并调整了 `engine/backend/Dockerfile` 的启动入口，以便在受控通道中接收秘书平台的运行时模型配置。上游后端 Python 源码未因此修改；配置只在引擎进程内存中生效，不写入引擎数据库。
