# Responses API 隔离试点

测试日期：2026-10-23。代码基线：`ea23c1a`。范围：开源版当前配置的阿里云百炼 `deepseek-v4.1-flash`，使用 `https://dashscope.aliyuncs.com/compatible-mode/v1`，全部采用虚构文字和内存工具。

**多轮续接、函数工具和流式回复通过；OpenAI 式压缩未得到验证。当前不禁用应用的摘要压缩，也不切换正式聊天。** 这次结果证明当前服务可作为 Responses 接入候选，尚不代表实际业务工具、长会话、桌面包和语音委派已迁移。

## 测试结果

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

## 请求和用量

- 总计 11 次 POST，含 1 次 Chat Completions 对照、8 次成功的 Responses 生成，以及无效 ID 和 compact 两次错误请求；未自动重试。
- 成功 Responses 请求合计输入 16,823 token、输出 151 token、总计 16,974 token。
- Chat Completions 对照返回总量 9 token；全部已返回的总用量为 **16,983 token**。错误请求未返回用量，不将其假定为已知零费用。
- 本次 Responses 成功请求耗时约 1.31～4.38 秒；唯一工具结果流的首段文字约 1.60 秒。样本与输入长度不同，不能据此宣称比旧接口更快。
- 使用当前模型配置，思考档位为 `none`，Responses 每次输出上限 512 token，独立进程回忆为 256。费用及免费额度以账号实际账单为准。

只读取模型设置，不读取正式消息、资料或邮箱，不调用正式业务工具。密钥仅在内存中使用，不打印、不复制到试点文件。当前服务端存储的会话内容均为合成测试数据，不含私人资料。

## 可复验入口

[试点脚本](../scripts/responses-pilot.mjs)默认仅显示用法；显式启用 `--live` 才请求模型。它只读设置表，并以环境变量作为回落，沿用当前服务商和模型，不自动切换模型或地域。

```powershell
# 离线验证流式解析、请求限额、错误脱敏和模拟工具
node --test scripts/responses-pilot.test.mjs

# 实际模型测试，会使用当前配置对应的账号额度
node scripts/responses-pilot.mjs --live
```

请求上限为 12 次 POST，包含独立续接进程，不含无限重试。仅允许预先列出的官方 HTTPS 服务域名，不跟随重定向。工具执行限定内存虚构任务，不能连接生产业务工具。

结果写入 Git 忽略的 `data/responses-pilot/<时间>/report.json`；同目录检查点只存测试标记、响应 ID 及非密钥的配置指纹，不存 API Key 或完整模型响应。本次原始结果为 `data/responses-pilot/2026-10-23T08-52-05-294Z/report.json`。报告中的 `request` 是各客户端的局部序号，汇总请求数以 `observedRequests` 为准。

错误响应只保留状态及通用错误类型，不把服务商原始正文或异常文本写入日志。发生超时和不确定执行时停止相应检查，不自动重复发起请求。后续脚本即使在其他服务商观察到压缩产物，也不能将协议测试自动视为应用迁移完成。

## 对后续实现的影响

1. **可以试点服务端续接。** 新建可选 Responses 路径，保存每个会话的最近响应 ID，核对请求去重、失败状态和恢复策略；当前代码仍使用原 Chat Completions。
2. **暂不移除窗口管理。** 当前服务的压缩条件没有通过；需要决定明确保留多少上下文、何时摘要并重建响应链，以及遇到过期 ID 如何恢复。不能在 ID 错误后静默重复执行写入，也不能将响应 ID 当作完整可备份历史。
3. **本机历史与资料工具继续保留。** 消息展示、附件、来源、范围保护、事务和执行审计仍由应用管理；Codex 继续使用自己的线程，不受此次测试影响。
4. **采用可选分支。** 真正接入时让确认可用的 Responses 路径跳过旧的每轮历史拼接；Chat Completions 继续使用原策略。压缩按能力单独选择，避免整段注释共享代码。

下一轮真实接入至少需要验证：原业务工具映射与写入去重、响应 ID 持久化、超时与重启、ID 不可用时的明确恢复、模型或配置切换、较长对话中的关键信息保留，以及 API、Codex、实时语音委派互不干扰。需使用可控的合成资料，保留现有历史和用户配置。

## 参考

- [阿里云 Responses 兼容说明](https://help.aliyun.com/zh/model-studio/compatibility-with-openai-responses-api)：当前模型支持和地域、路径说明。
- [阿里云 DeepSeek 接口](https://help.aliyun.com/zh/model-studio/deepseek-api)：`deepseek-v4.1-flash` 的 Responses 支持。
- [OpenAI Responses 迁移](https://developers.openai.com/api/docs/guides/migrate-to-responses)：输出 Items、工具回传与续接。
- [AI 对话功能对齐与接口演进计划](AI对话功能对齐与接口演进计划.md)：后续功能推进和产品验收清单。
