# Pi Harness 隔离试点

架构决策、实测结果和产品迁移边界见 [Pi 内置 Harness 架构与试点](../../docs/Pi内置Harness架构与试点.md)。本目录不接入正式聊天、数据库或桌面安装包。SDK 为固定版本 `@earendil-works/pi-coding-agent@1.4.0`，Node.js 最低 22.19；本轮实测使用 Node 24.19.0。

## 安装与离线测试

必须在此目录内安装，避免 npm 将调用目录作为本地依赖加入：

```powershell
cd experiments/pi-harness
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

使用独立 package.json / lockfile，不改变根项目依赖。`--ignore-scripts` 禁止依赖安装脚本；当前测试只需文本工具，不要求图像或原生命令执行环境。依赖及数据分别被 `node_modules/`、根目录 `data/` 忽略。

## 真实模型测试

在根项目 `.env` 配置 `DEEPSEEK_API_KEY`，密钥不写入源码、命令行、会话或报告。只用官方 `https://api.deepseek.com` 和 `deepseek-flash`；SDK 经 Chat Completions 调用，Pi 在本机管理上下文。进程中的同名环境变量优先于 `.env`。

```powershell
# 在此目录运行；省略 --live 只显示用法
node pilot.mjs --live

# 使用上一步打印的实际运行目录，补测显式压缩后体积及事实保留
node pilot.mjs --live --verify-compaction=../../data/pi-harness-pilot/<运行目录>
```

基础试验最多 12 次实际 POST，包含独立进程恢复与摘要；显式补充验证后累计最多 16 次。网络、HTTP 错误或未确认的请求会停止后续调用；不自动重试整轮，也不重放业务操作。仅当压缩判定阶段中止、尚未进入业务阶段时，`--continue=<运行目录>` 可复用已保存的合成会话继续；不是通用失败恢复入口。

请求正文最多 120KB，每次输出上限 2,048 token，每次 fetch 超时 60 秒，单次 prompt 90 秒后取消。SDK 默认重试关闭，传输层只允许官方 Chat Completions URL；拒绝重定向及非声明工具。报告含实际 HTTP 计数、状态、已观察的流式用量，以及 Pi 持久化消息/摘要中的 token 回执。拆分摘要的多次调用可能合并为一条摘要用量，因此回执条数不必等于 HTTP 次数。SDK 配置的价格为占位值，不用于估算账单。

## 已验证的范围

- 真实 SDK 的文字流、模拟任务工具循环、独立进程恢复及会话隔离。
- 自动压缩与显式压缩；缩小本地窗口与保留量是测试条件，不是模型真实窗口或产品默认值。
- 仅按合成附件 ID 授权；任务 A 不能读取任务 B 的附件。
- 本轮成功读取才生成引用；伪造或旧轮标记不被接受。这是平台引用适配的原型，没有接上正式引用 UI。
- 新文件生成、回读、原件不变；拒绝越界路径、覆盖、跨任务产物与链接文件。
- 模拟业务 requestId 去重，包括重新创建 host 后再次处理；取消中的模型请求不写业务、不隐式重试。

只注册四个自定义工具，不启用 Pi 内置 read/bash/edit/write，不发现全局 skills、扩展、上下文文件或凭据。文件工具用单文件名和实际路径检查限制访问；这不等于提供了可运行任意代码的操作系统沙箱。试点的 JSON 业务存储和引用器不能直接作为生产事务、授权或引用实现使用。

运行证据包含 JSONL 会话、合成附件、产物、请求计数及 report.json，全部留在根目录 `data/pi-harness-pilot/`。不提交这些原始运行文件。正式接入仍需复用平台事务、权限与引用层，适配 UI/语音事件、旧会话迁移、备份/删除，并验收 Windows 安装包。
