# Responses API 隔离试点

测试日期：2026-10-23。第一轮代码基线：`ea23c1a`；第二轮在 `228caf9` 上扩展官方配置与无状态检查。范围：阿里云百炼 `deepseek-v4.1-flash`（`https://dashscope.aliyuncs.com/compatible-mode/v1`），以及 DeepSeek 官方 `deepseek-flash`（`https://api.deepseek.com`），全部采用虚构文字和内存工具。

**阿里云通过服务端续接；DeepSeek 官方为无状态接口，需显式回传历史，函数工具与流式回复通过。两家均未验证 OpenAI 式压缩。当前不禁用应用的摘要压缩，也不切换正式聊天。** 这些结果仅验证隔离协议，尚不代表实际业务工具、长会话、桌面包和语音委派已迁移。

## 阿里云百炼结果

| 测试 | 实际结果 | 判断 |
| --- | --- | --- |
| 现有 Chat Completions 对照 | HTTP 200，按要求返回 OK | 当前模型与凭据可用 |
| Responses 基础调用 | HTTP 200，`status=completed`，返回正文与响应 ID | 通过 |
| 独立进程续接 | 第一进程保存响应 ID；新 Node 进程只发送 ID 和问题，准确返回上一轮的随机标记 | 服务端续接通过，无需重放本地完整历史 |
| 函数工具调用 | 返回一项 `createTask` 调用，标题与日期准确；内存模拟工具重复处理同一调用仍只保留一条任务 | 协议与模拟执行通过，未写业务库 |
| 工具结果与流式回复 | 使用 `function_call_output` 和原 `call_id` 回传结果；SSE 的文字与最终正文一致，回复含实际模拟任务 ID 与标题 | 通过 |
| 新会话隔离 | 不携带旧响应 ID 的新请求不知道原标记，按指令返回 UNKNOWN | 合成样本通过 |
| 无效响应 ID | HTTP 400，未重试或重放业务操作 | 错误路径通过 |
| 独立 `/responses/compact` | POST 返回 HTTP 405 | 该地址未提供所测调用方式 |
| 非法压缩参数对照 | `context_management` 故意传入错误类型，仍 HTTP 200 并返回 OK | 不能依据成功状态认定该参数被处理 |
| 服务端压缩阈值 | 传入 `compact_threshold=1024`，输入用量 7,906 token；仅返回 `message`，无 `compaction` 产物 | 未观察到 OpenAI 式压缩 |
| 阈值请求后续接 | 正确回忆开头的标记，但下一轮输入仍为 7,926 token | 续接正常，没有观察到本样本输入体积压缩 |

不能用上述短上下文测试推断达到模型真实窗口上限后的行为。它验证了参数接收、返回产物、用量与续接，未通过大量填充触发真实上限，也没有把普通自动截断等同于摘要压缩。

阿里云的[创建响应文档](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses)说明：未列出的 OpenAI 参数会被忽略，接近窗口上限时存在自动截断。当前文档未列出本次测试的 `context_management`。OpenAI 的[压缩文档](https://developers.openai.com/api/docs/guides/compaction)则明确规定阈值压缩及返回的压缩状态。两者需要分别验证，不能由“兼容 Responses”推断完整支持相同的上下文策略。

### 请求和用量

- 总计 11 次 POST，含 1 次 Chat Completions 对照、8 次成功的 Responses 生成，以及无效 ID 和 compact 两次错误请求；未自动重试。
- 成功 Responses 请求合计输入 16,823 token、输出 151 token、总计 16,974 token。
- Chat Completions 对照返回总量 9 token；全部已返回的总用量为 **16,983 token**。错误请求未返回用量，不将其假定为已知零费用。
- 本次 Responses 成功请求耗时约 1.31～4.38 秒；唯一工具结果流的首段文字约 1.60 秒。样本与输入长度不同，不能据此宣称比旧接口更快。
- 使用当前模型配置，思考档位为 `none`，Responses 每次输出上限 512 token，独立进程回忆为 256。费用及免费额度以账号实际账单为准。

只读取模型设置，不读取正式消息、资料或邮箱，不调用正式业务工具。密钥仅在内存中使用，不打印、不复制到试点文件。当前服务端存储的会话内容均为合成测试数据，不含私人资料。

## DeepSeek 官方结果

使用用户提供的环境变量文件中的 `DEEPSEEK_API_KEY`，不读取业务库，也不修改当前应用的服务商或模型设置。官方配置固定使用 `deepseek-flash`，不复用阿里云密钥。

| 测试 | 实际结果 | 判断 |
| --- | --- | --- |
| Chat Completions 对照与 Responses 基础调用 | 均 HTTP 200，按要求返回 OK；Responses 有响应 ID | 官方模型与凭据可用 |
| 独立进程仅凭响应 ID 续接 | HTTP 200，但未回忆正确标记；`previous_response_id` 未关联，所有模型响应均为 `store:false`，即使请求 `store:true` | 不支持服务端会话续接，不能只看 HTTP 状态 |
| 显式回传历史 | 回传原用户消息与前轮 output 后准确回忆随机标记 | 客户端历史回放通过 |
| 函数工具调用 | `createTask` 参数正确，内存模拟工具去重通过 | 未写业务库 |
| 仅凭响应 ID 回传工具结果 | `previous_response_id` 加 `function_call_output` 返回 HTTP 400 | 不能据 ID 找回前轮函数调用 |
| 显式工具历史与流式回复 | 回传原请求、函数调用和函数结果后 HTTP 200，SSE 与最终正文一致，含正确任务 ID 和标题 | 无状态工具协议通过；复用模拟执行结果，未再次写入 |
| 新会话隔离 | 不回传历史的新请求返回 UNKNOWN | 合成样本通过 |
| 无效响应 ID | 假 ID 仍 HTTP 200，未关联前轮响应 | 该参数被忽略，不能用其成功状态证明恢复成功 |
| 独立 `/responses/compact` | HTTP 404 | 所测入口不可用 |
| 非法压缩参数对照 | 错误类型的 `context_management` 仍 HTTP 200 | 未校验该参数 |
| 服务端压缩阈值 | `compact_threshold=1024`，输入 7,877 token，仅返回 `message`，无 `compaction` | 未观察到服务端压缩；因不支持 ID 续接，未另发阈值后的 ID 回忆请求 |

DeepSeek 官方的 [Responses API 指南](https://api-docs.deepseek.com/zh-cn/guides/responses_api/)明确列出：不支持 `previous_response_id`、`conversation`、`context_management`；`store` 始终为 false，不支持的参数会被静默忽略。其[创建响应说明](https://api-docs.deepseek.com/zh-cn/api/create-response/)明确要求客户端每轮在 input 中回传历史。这与本次结果一致。超出上下文窗口会报错，不能依赖自动截断替代应用的窗口管理。

### 请求和用量

- 总计 **12 次 POST**，含 Chat Completions 对照、独立进程续接、两项显式历史检查及错误路径；未自动重试。
- 全部已返回用量合计输入 **8,824 token**、输出 **129 token**、总计 **8,953 token**，包含 Chat Completions 对照的 9 token。两次错误请求未返回用量，费用以实际账单为准。
- 成功 Responses 请求约 0.56～0.86 秒；显式工具历史流首段文字约 717 毫秒、整轮 860 毫秒。输入与阿里云样本不同，不能据此判断服务商或接口性能高低。
- 报告结论为 `stateless_protocol_passed`，`safeToDisableApplicationCompaction:false`。这表示显式历史模式可用，不表示服务端会话管理通过。

## 两家能力对照

| 能力 | 阿里云所测模型 | DeepSeek 官方所测模型 |
| --- | --- | --- |
| 基础文字、函数工具、流式回复 | 通过 | 显式回传工具历史后通过 |
| 仅凭前轮响应 ID 续接 | 通过 | 不支持，参数被忽略 |
| 独立 compact 入口 | HTTP 405 | HTTP 404 |
| 阈值压缩产物 | 未观察到 | 未观察到，官方文档明确不支持 |
| 可否停用应用的历史整理与摘要 | 仍需窗口管理和恢复历史 | 仍需每轮历史整理与窗口管理 |

## 可复验入口

[试点脚本](../scripts/responses-pilot.mjs)默认仅显示用法；显式启用 `--live` 才请求模型。默认只读设置表，并以环境变量作为回落，沿用当前服务商和模型。`--provider=deepseek` 则使用独立的官方配置，不读取设置表、不更改正式配置。`--env-file` 可指定只读环境变量文件；省略时读取项目 `.env`，进程环境变量优先。

```powershell
# 离线验证流式解析、请求限额、错误脱敏和模拟工具
node --test scripts/responses-pilot.test.mjs

# 实际模型测试，会使用当前配置对应的账号额度
node scripts/responses-pilot.mjs --live

# 官方 DeepSeek 独立试点，环境变量文件需包含 DEEPSEEK_API_KEY
node scripts/responses-pilot.mjs --live --provider=deepseek --env-file=/path/to/.env
```

请求上限为 12 次 POST，包含独立续接进程，不含无限重试。仅允许预先列出的官方 HTTPS 服务域名，不跟随重定向。工具执行限定内存虚构任务，不能连接生产业务工具。

结果写入 Git 忽略的 `data/responses-pilot/<时间>/report.json`；同目录检查点只存测试标记、响应 ID 及非密钥的配置指纹，不存 API Key 或完整模型响应。阿里云原始结果为 `data/responses-pilot/2026-10-23T08-52-05-294Z/report.json`；DeepSeek 官方原始结果为 `data/responses-pilot/2026-10-23T09-14-26-779Z/report.json`。这些本机文件不随仓库发布；可共享结论记录在本文。报告中的 `request` 是各客户端的局部序号，汇总请求数以 `observedRequests` 为准。

错误响应只保留状态及通用错误类型，不把服务商原始正文或异常文本写入日志。发生超时和不确定执行时停止相应检查，不自动重复发起请求。后续脚本即使在其他服务商观察到压缩产物，也不能将协议测试自动视为应用迁移完成。

## 对后续实现的影响

1. **按厂商选择续接策略。** 仅对验证支持服务端续接的服务商建立响应 ID 映射，并核对请求去重、失败状态和恢复策略；DeepSeek 官方 Responses 仍需组织消息及工具历史。当前正式代码仍使用原 Chat Completions。
2. **暂不移除窗口管理。** 两家的压缩检查均未通过；仍需明确保留多少上下文、何时摘要，以及支持续接时如何重建响应链和处理过期 ID。不能在 ID 错误后静默重复执行写入，也不能将响应 ID 当作完整可备份历史。
3. **本机历史与资料工具继续保留。** 消息展示、附件、来源、范围保护、事务和执行审计仍由应用管理；Codex 继续使用自己的线程。即使 Codex 使用 DeepSeek 模型，历史管理也是 harness 的职责，不能据此推断 DeepSeek API 有服务端会话。
4. **采用能力分支。** 只有验证支持服务端续接的路径才可跳过旧的每轮历史拼接；无状态 Responses 与 Chat Completions 继续由应用整理上下文。压缩按能力单独选择，避免整段注释共享代码。

下一轮真实接入至少需要验证：原业务工具映射与写入去重、响应 ID 持久化、超时与重启、ID 不可用时的明确恢复、模型或配置切换、较长对话中的关键信息保留，以及 API、Codex、实时语音委派互不干扰。需使用可控的合成资料，保留现有历史和用户配置。

## 参考

- [阿里云 Responses 兼容说明](https://help.aliyun.com/zh/model-studio/compatibility-with-openai-responses-api)：当前模型支持和地域、路径说明。
- [阿里云 DeepSeek 接口](https://help.aliyun.com/zh/model-studio/deepseek-api)：`deepseek-v4.1-flash` 的 Responses 支持。
- [DeepSeek 官方 Responses 指南](https://api-docs.deepseek.com/zh-cn/guides/responses_api/)：无状态能力与不支持的参数。
- [DeepSeek 官方创建响应](https://api-docs.deepseek.com/zh-cn/api/create-response/)：客户端历史回传要求。
- [OpenAI Responses 迁移](https://developers.openai.com/api/docs/guides/migrate-to-responses)：输出 Items、工具回传与续接。
- [AI 对话功能对齐与接口演进计划](AI对话功能对齐与接口演进计划.md)：后续功能推进和产品验收清单。
