# 两个 DSH 插件的实现参考

核对时间：2026-11-13。以下基于所链接仓库的 README 和源码阅读，没有安装、执行第三方插件，也没有审计整个仓库。

## 与主界面的关系

- [歸藏设计](https://github.com/op7418/dsh-guizang-design/blob/main/lib/client.js) 注册 DSH 的 `sidebar.panellist` 和 `main` 插槽，在主区域使用 iframe 加载自己的页面；与页面传递消息时检查来源窗口和同源。它在自身页面创建新会话草稿，保留 DSH 外壳。
- [自媒体工作台](https://github.com/woniuniuniu/dsh-media-desk/blob/main/client/index.jsx) 也在 DSH 侧栏注册入口，把多栏目导航放在自己的主面板里；其界面还根据自身容器宽度收起对话栏。两个项目证明插件可拥有完整业务页面，但所读代码不表明它们替换了 DSH 的全局侧栏。
- 前者有利于隔离独立网页，后者直接打包 React 并使用宿主 React。当前秘书试验直接复用秘书组件，继续采用后者一类的方式更直接；它并不能单独解决单侧栏问题。

## 数据与对话

- [歸藏作品库](https://github.com/op7418/dsh-guizang-design/blob/main/lib/library.js) 在 DSH_HOME 保存作品索引，记录作品路径和元数据，工具登记后页面读取；[工具](https://github.com/op7418/dsh-guizang-design/blob/main/lib/tools.js)与宿主共同使用这些逻辑。可借鉴作品登记、明确返回数据以及同一份数据由 AI 和页面使用的设计。引用外部作品路径不会让作品自动跨设备同步。
- [自媒体工作台](https://github.com/woniuniuniu/dsh-media-desk/blob/main/src/store.js) 在 DSH_HOME 保存 JSON，进程内串行写入并用临时文件替换，按修改时间刷新。它还提供操作撤销；这些机制本身不等于跨进程写入有锁或绝无冲突。
- 其[专属对话](https://github.com/woniuniuniu/dsh-media-desk/blob/main/src/host.js)根据当前内容调用模型并执行结构化操作；[模型调用代码](https://github.com/woniuniuniu/dsh-media-desk/blob/main/src/ai.js)复用 DSH 模型服务，但该功能有自己的提示词、消息和执行逻辑，不等同于直接嵌入 DSH 原生通用 Agent。任务专属对话可以参考体验和数据边界，是否复用原生 Agent 要另行验证。

## 构建与依赖

- [自媒体工作台构建脚本](https://github.com/woniuniuniu/dsh-media-desk/blob/main/scripts/build.mjs)以 React 为宿主依赖，将客户端编译为 DSH 模块；其[清单](https://github.com/woniuniuniu/dsh-media-desk/blob/main/package.json)没有把一组 DSH 内部包作为运行时依赖。[歸藏清单](https://github.com/op7418/dsh-guizang-design/blob/main/package.json)同样未引入那组 DSH 内部包；其工具直接提供 JSON Schema 和执行函数，自行验证参数。
- 我们的隔离对照中，旧版幻灯片插件安装大量 DSH 包时，0.2.2-rc.2 新会话初始化报告重复 persona；轻依赖版移除这些包后，新会话可初始化，且真实模型成功调用工具创建作品，作品出现在列表中。该现象支持减少依赖，但还不能证明具体哪个包是根因，也不能替代用户桌面验收。正式实现保留了工具输入校验、数据校验和输出约定。
- 许可不同：歸藏设计为 AGPL-3.0-only，自媒体工作台为 MIT。采用思路和接口时仍要独立实现；如需复制代码，先核对具体文件许可与项目兼容性。
