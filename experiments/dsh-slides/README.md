# 知识幻灯片 DSH Go 试验插件

这是个人 AI 秘书的隔离试验，不会连接或修改现有秘书应用的数据库。插件在 DSH 的本机数据目录中保存 Markdown 幻灯片；AI 可以创建、列出和读取。DSH Go 的“全部功能”或对话中的“幻灯片”入口打开原生面板，选择作品后可以翻页。

此版验证端到端流程：面板按页显示文字和少量 Markdown 格式，并非秘书应用现有的 Marp 排版阅读器；长页可能拆成多屏。不支持导出 PPTX、编辑、删除或跨设备同步。通过其他主机远程连接时，数据在该主机上，且原生面板依赖 DSH Go 桥接。

## 手机安装与体验

1. 安装社区项目 [DSH Go](https://github.com/ccch1mneyyy/dsh-Go/releases)，选择本机引擎并完成模型配置；模型凭据请直接在应用中填写。
2. 将 `dsh-secretary-slides-pilot-0.1.0.tgz` 下载到手机“下载”目录。在 DSH Go 设置中允许访问手机文件。
3. 打开 DSH Go 的本机终端，执行：

   ```sh
   dsh plugin --profile web add /sdcard/Download/dsh-secretary-slides-pilot-0.1.0.tgz
   ```

   安装需要联网下载插件依赖。如果提示重启引擎，或安装后没有出现插件，在 DSH Go 中重启本机引擎。
4. 发消息：“请帮我制作一份讲解光合作用的知识幻灯片。” 等待 AI 完成并确认工具成功。
5. 从对话中的“幻灯片”入口或“全部功能”打开“知识幻灯片”，点击新作品并翻页；关闭 App 后重开，再检查列表。
6. 在插件设置中关闭该插件，确认入口和工具不可用；重新开启后检查作品仍在。

暂不保证与全部 DSH Go 版本兼容。该试验目标版本为 DSH `0.2.2-rc.1`，需要手机实测验证。卸载插件不会主动删除数据，但清理或重置 DSH 数据可能影响文件；请先按 DSH Go 的说明备份。

## 开发

仓库内运行 `node experiments/dsh-slides/build-shared.mjs`，从秘书项目的 `src/lib/slides/contracts.ts` 生成插件使用的校验代码。安装依赖后，运行 `node --test experiments/dsh-slides/test/plugin.test.js`；可以用 DSH Go 的 `sdk/plugin-kit/bin/check.mjs` 检查插件清单和原生视图。插件源码继承仓库的 AGPL-3.0-or-later 许可。
