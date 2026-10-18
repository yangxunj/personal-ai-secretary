# Gmail 桌面试点

当前源码版本 `0.6.0-beta.1` 增加 Windows 桌面 Gmail 只读试点。稳定版 v0.5.0 不含此功能。

在桌面应用的「邮件」页连接自己的邮箱；用户明确允许后，应用读取邮件并调用当前聊天后端生成候选提醒。可手动将线索转为待办。定期检查和桌面通知分别开启，默认关闭。

## 第一次连接

1. 在 [Google Cloud](https://console.cloud.google.com/apis/credentials) 创建或选择自己的项目，启用 Gmail API。
2. 配置 OAuth 同意屏幕。个人测试时将自己的 Google 账号加入测试用户。
3. 创建类型为 **Desktop app** 的 OAuth 客户端，下载客户端 JSON。
4. 打开桌面应用「邮件 → 导入 OAuth 配置」，选择该 JSON。应用校验客户端类型和 Google 授权地址，保存到自己的独立目录。
5. 点击「连接 Gmail」，在这台电脑的系统浏览器中选择账号，授予 Gmail 只读和基本身份权限。GWS 使用本机回调，授权链接应在运行应用的电脑上打开。
6. 回到应用核对显示的邮箱。阅读当前分析服务说明，勾选允许分析并保存，再点击「立即同步」。

不复用开发者、私人秘书项目或其他安装实例的邮箱令牌。用户可自行选择已有的 Desktop OAuth 客户端配置，但本应用会建立独立授权和扫描记录。Google External / Testing 状态下，包含 Gmail 权限的刷新令牌通常 7 天过期，需要重新授权；长期自用与公开分发的 OAuth 状态及验证要求需要分别处理。

## 分析与提醒

- 首次同步范围为连接时最近 7 天，之后按固定时间窗口、分页位置和邮件 ID 去重处理新增邮件。不按“未读”判断是否已经分析。
- 每批最多分析 20 封；页面显示有待补扫时可继续同步，定期模式下积压会以一分钟间隔继续分批处理。
- 正文最多 12000 字符，超长时标注截断；附件仅列名称，不下载和分析附件内容。
- 使用设置页当前选择的 API 或本机 Codex 后端。分析服务与模型变化后需要重新确认处理授权。
- 只返回摘要、建议行动、重要性、明确截止日期和原文证据。重要线索缺乏可核对证据、AI 结果不完整或日期无效时，本批失败并保留原扫描位置。
- 账单不直接代表未缴费，扣款通知也不能自动证明另一份账单已缴。涉及付款和期限应核对原邮件。
- 「已处理」「忽略」只影响本机线索，不改变 Gmail 已读状态或邮件标签。
- 「转为待办」是用户主动操作，重复点击同一线索不会重复创建任务；来源与证据会写入任务详情。
- 保留最近 500 条候选提醒；完整邮件镜像、历史邮件导入与仅标签变动同步不在本次试点范围。

定期检查默认每 60 分钟，可选 10 或 30 分钟；可随时暂停。完全退出应用、关闭窗口或电脑休眠后停止检查，已开启定期模式的连接在下次启动时补扫。本版没有托盘常驻、自动开机运行或手机推送。

桌面通知只显示通用提示，不把邮件正文或摘要显示到锁屏。Windows 的通知设置可能阻止弹窗；线索仍可在应用里查看。

## 数据与授权边界

数据位于应用实际数据目录下的 `gmail/`：安装版通常为 `%APPDATA%/家庭管家/data/gmail/`，ZIP 和单文件版则为程序旁的 `data/gmail/`。

- `account/`：用户导入的 Desktop OAuth 配置，以及 GWS 管理的加密凭据。Windows 下使用系统凭据管理器提供的密钥；免安装目录搬到另一台电脑后可能需要重新连接。
- `state.json`：扫描位置、去重记录、摘要、证据与本机处理状态。不保存完整邮件正文。这些记录仍可能包含个人信息，以本机文件访问权限保护。
- `analysis/`：隔离的本机 Codex 工作目录。本机分析要求引擎确认临时线程，且未返回持久日志路径，才会发送正文；临时线程不等于云端零留存。

用户开启 AI 分析后，邮件正文会发送给设置页所选择的模型服务商，使用该账号或 API Key 的额度。API 分析不提供业务工具；Codex 分析与常规聊天独立，并拒绝平台操作请求。邮件内容始终作为不可信外部数据处理。

连接、导入配置、读取线索、同步和转待办都经桌面主窗口的受限 IPC。内部 HTTP 接口要求进程级随机凭据，不将凭据下发网页。网页版、手机转发页、外部页面和 iframe 无法通过该入口读取邮箱。

「断开并清除本机邮件数据」先中止本轮工作，再清除本应用的本机 Gmail 凭据、摘要与扫描记录，保留已经创建的待办。Google 账户中已授予的应用访问权限可以在 [账户安全页](https://myaccount.google.com/permissions)另行撤销；本应用不替其他项目管理授权。

当前数据库和上传文件备份流程没有覆盖 `gmail/`。邮箱连接凭据不应作为普通业务文件打包共享；丢失或损坏的台账会停止扫描，不自动扩大到历史邮箱。重新连接前先保留需要的本机记录。

## 构建与验证

桌面构建会准备固定的 GWS CLI `v0.22.5` Windows x64 工具，核对固定归档与可执行文件 SHA-256，并随包携带 Apache-2.0 LICENSE。工具缓存位于被 Git 忽略的 `desktop/tools/`，不依赖用户全局 PATH、单独安装 Node 或私人项目中的可执行文件。

```sh
node --test scripts/gmail.test.mjs
npx tsc --noEmit
node scripts/i18n-check.mjs
cd desktop
node scripts/prepare.mjs --no-key
npx electron-builder --win --x64
```

构建应放在隔离源码目录，避免覆盖正在运行的 `.next`。公开发布继续使用 `--no-key`，检查空模板库、GWS 许可和工具校验值，并确保包内没有账户配置、令牌、扫描记录或私人业务资料。

自动验证使用虚构邮箱、模拟 GWS 与模型，覆盖只读白名单、凭据隔离、主窗口权限、分页与失败恢复、证据校验、处理授权变化、临时线程、暂停清理和手动建任务的幂等性。真实用户的 Google 授权、长期令牌有效性、实际云端分析效果与 Windows 通知送达，需要用户连接自己的邮箱后继续验收。

本次试验包已通过全部 79 项回归测试、类型和中英文词典检查。实际运行最终 Windows ZIP，验证了邮件入口、原生桥接、空账户初始状态、未授权 HTTP 请求被拒绝、虚构线索转待办与重复操作、断开清理、390px 布局及正常退出。安装包通过归档完整性检查，包内 22 张业务表均为空，未包含已知本机密钥；没有实际安装覆盖既有版本，也未连接真实邮箱或调用付费分析服务。

## 参考

- [GWS CLI v0.22.5](https://github.com/googleworkspace/cli/releases/tag/v0.22.5)，Apache-2.0；项目注明不是 Google 官方支持的产品。
- [Gmail 权限](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [OAuth 令牌有效期](https://developers.google.com/identity/protocols/oauth2#expiration)
- [受限权限验证](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Google Workspace 数据政策](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
