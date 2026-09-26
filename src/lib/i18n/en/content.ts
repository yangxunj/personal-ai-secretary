import type { Dict } from '../core';

/**
 * 资料、文件、文稿、搜索、专题、页面，以及几个共用小组件（页头、主题开关、
 * 复制按钮、图片墙、附件行）。key 必须跟 t('…') 里的字符串一字不差。
 */
export const content: Dict = {
  // ---------- 几处共用 ----------
  全部: 'All',
  附件: 'Attachments',
  '附件 {n}': '{n} {n|attachment|attachments}',
  '{n} 个附件': '{n} {n|attachment|attachments}',
  '+ 新建': '+ New',
  '删除中…': 'Deleting…',
  确定删除: 'Confirm delete',
  '删除 {name}': 'Delete {name}',
  返回任务: 'Back to tasks',
  '「{text}」': '“{text}”',
  未授权: 'Unauthorized',

  // ---------- 资料 ----------
  资料库: 'Vault',
  '标签「{tag}」· {n} 条': 'Tag “{tag}” · {n} {n|entry|entries}',
  '{n} 条记录': '{n} {n|entry|entries}',
  新建资料: 'New entry',
  '搜索账号、地址、号码…': 'Search accounts, addresses, numbers…',
  '标签：': 'Tag: ',
  '资料库还是空的。': 'The vault is empty.',
  '银行账号、学校账号、住址、证件号都可以存在这里。': 'Bank accounts, school logins, addresses and ID numbers can all go here.',
  '名称，例如：招商银行储蓄卡': 'Name, e.g. Chase checking account',
  字段: 'Fields',
  项目: 'Label',
  内容: 'Value',
  '+ 加一行': '+ Add a row',
  '备注（可选）': 'Notes (optional)',
  '标签，逗号分隔（可选）': 'Tags, comma-separated (optional)',
  '敏感信息（列表中默认打码）': 'Sensitive (masked in the list by default)',
  请长按选取: 'Long-press to select',

  // ---------- 文件 ----------
  '{n} 个文件 · {size}': '{n} {n|file|files} · {size}',
  '还没有文件。': 'No files yet.',
  '在「沟通」里点回形针，就能把账单、报告发过来。': 'Tap the paperclip in Chat to send bills and reports.',
  管家生成: 'made by the steward',
  '任务：{title}': 'Task: {title}',
  '资料：{title}': 'Vault: {title}',
  文件不存在: 'File not found',
  文件已丢失: 'File is missing',

  // ---------- 文稿 ----------
  '{n} 篇 · 共 {chars} 字': '{n} {n|piece|pieces} · {chars} characters',
  '还没有文稿。': 'No writings yet.',
  '发言稿、文章、信件这类成篇的文字会收在这里。': 'Speeches, articles, letters and other long-form writing are kept here.',
  '{chars} 字': '{chars} characters',
  返回文稿列表: 'Back to writings',
  '源文件：': 'Source file: ',
  已复制全文: 'Copied',
  '复制失败，长按下方正文': 'Copy failed. Long-press the text below',
  复制全文: 'Copy all',
  '下载 Markdown 文件': 'Download Markdown file',
  '复制的是 Markdown 原文，粘到别的 AI 那边标题和表格都还在。':
    'Copies the Markdown source, so headings and tables survive when pasted into another AI.',

  // ---------- 搜索 ----------
  '“{q}” 找到 {n} 条': '{n} {n|result|results} for “{q}”',
  '记录 · 任务 · 资料 · 财务 · 文稿 · 文件': 'Messages · Tasks · Vault · Finance · Writings · Files',
  '搜点什么，比如 门锁、图书馆、Claude…': 'Search anything, e.g. door lock, library, Claude…',
  '一次搜遍全部六个板块。': 'Searches all six sections at once.',
  '账号、号码、商户名、文件名都能搜。': 'Accounts, numbers, merchants and file names are all searchable.',
  '没找到「{q}」。': 'Nothing found for “{q}”.',
  '换个说法试试，或者直接问管家。': 'Try different words, or just ask the steward.',
  '去{kind}页 →': 'Go to {kind} →',
  记录: 'Messages',
  交易: 'Transactions',
  支出: 'Spent',
  收入: 'Received',

  // ---------- 专题 ----------
  // TOPIC_STATUS（lib/topic.ts）
  在进行: 'Active',
  有结论: 'Settled',
  搁置: 'Parked',
  '{status} {n} 个': '{status} · {n}',
  '还没有专题。': 'No topics yet.',
  '有什么想弄明白的事，在「沟通」里跟我说一声。': 'Anything you want to get to the bottom of? Tell me in Chat.',
  '没有「{status}」的专题。': 'No topics marked “{status}”.',
  都清楚了: 'All clear',
  '还有 {n} 件没弄清': '{n} open {n|question|questions}',
  有呈现页: 'Has a page',
  '任务 {n}': '{n} {n|task|tasks}',
  '页面 —— 在对话里让 AI 做的图表、报告、小游戏': 'Pages: charts, reports and mini games the AI made in chat',
  '文稿 —— 主人写的发言稿、文章、信件': 'Writings: your speeches, articles and letters',
  打开呈现页: 'Open the page',
  '图文并茂的完整版，可以加到主屏幕': 'The full illustrated version; you can add it to your home screen',
  现状: 'Where things stand',
  还没搞清楚的: 'Still open',
  '都弄清楚了 —— 这个专题可以标成「有结论」了。': 'Everything’s answered. This topic can be marked “Settled”.',
  相关任务: 'Related tasks',
  原始材料: 'Source materials',
  相关记录: 'Related messages',
  '完整对话在「记录」里 —— 这里只是把跟这个专题有关的聚过来。':
    'The full conversation is in Messages; this only gathers what relates to this topic.',
  '更新于 {date}': 'Updated {date}',
  专题不存在: 'Topic not found',
  '「{title}」还没有呈现页': '“{title}” doesn’t have a page yet',

  // ---------- 页面 ----------
  // PAGE_KINDS（lib/pages.ts）
  数据快照: 'Data snapshot',
  小程序: 'Mini app',
  // SAMPLE_CATEGORIES（lib/sample-pages.ts）；「教育」「工作」在 common.ts
  游戏: 'Games',
  生活: 'Life',
  '{n} 个 · 在对话里让 AI 做的': '{n} · made by the AI in chat',
  '在对话里让 AI 做的': 'Made by the AI in chat',
  '你还没让 AI 做过页面。': 'You haven’t asked the AI for a page yet.',
  '还没有页面。': 'No pages yet.',
  '在对话里说一句，AI 会把它做成一个网页放在这里。比如：':
    'Say it in chat and the AI will build a web page and put it here. For example:',
  '做个页面，看看今年每个月钱都花在哪了': 'Make a page showing where the money went each month this year',
  '把全家的保单做成一张缴费日历': 'Turn the family’s insurance policies into a premium calendar',
  '做个贪吃蛇小游戏，手机上能玩': 'Make a snake game I can play on my phone',
  '做个页面，列出家里每个人最近一次体检的异常项': 'Make a page listing the abnormal results from everyone’s latest checkup',
  示例: 'Samples',
  '下面这些都是在对话里说一句话做出来的，点开能直接玩、直接用，详情页上有当初那句话。':
    'Each of these was made from a single sentence in chat. Open one to play with it or use it; its page shows the original request.',
  '照着说、或者让 AI 在它基础上改都行。用不着的可以删掉。':
    'Ask for something similar, or have the AI adapt one. Delete any you don’t need.',
  '示例 · {category}': 'Sample · {category}',
  '{time} 更新': 'Updated {time}',
  '改过 {n} 次': 'edited {n} {n|time|times}',
  '按最新数据重新生成页面「{title}」（id: {id}），原来的要求是：{request}':
    'Regenerate the page “{title}” (id: {id}) with the latest data. The original request was: {request}',
  '把页面「{title}」（id: {id}）改一下：': 'Change the page “{title}” (id: {id}): ',
  用最新数据重做: 'Rebuild with latest data',
  全屏: 'Full screen',
  下载: 'Download',
  '在对话里这样说就能做出来：': 'Say this in chat to make it: ',
  '当初的要求：': 'Original request: ',
  照这个改一个自己的: 'Make my own version',
  在对话里改它: 'Change it in chat',
  '做它的那个对话：': 'Made in: ',
  没起标题的对话: 'Untitled conversation',
  历史版本: 'Version history',
  '（{n}）': '({n})',
  上一版: 'previous',
  恢复这版: 'Restore',
  '确定删除（连同历史版本）': 'Confirm delete (including history)',
  删除这个页面: 'Delete this page',
  页面不存在: 'Page not found',

  // ---------- 小组件 ----------
  上一张: 'Previous',
  下一张: 'Next',
  主题: 'Theme',
  跟随系统: 'System',
  浅色: 'Light',
  深色: 'Dark',
  '主题：{mode}，点击切换': 'Theme: {mode}. Click to change',
  '主题：{mode}': 'Theme: {mode}',
  '测试环境 · 这里的数据开发者会看到 · ': 'Test environment · the developer can see this data · ',
  别填真实证件号和卡号: 'Don’t enter real ID or card numbers',

  // ---------- 发文件时的提示（lib/file-support.ts，对话页显示） ----------
  'HEIC 照片 AI 看不了，iPhone 上可以截个图再发，或者设置里把照片格式改成「兼容性最佳」':
    'The AI can’t read HEIC photos. Send a screenshot instead, or set the iPhone camera format to “Most Compatible”.',
  '这种图片格式 AI 看不了，截个图（PNG/JPG）再发': 'The AI can’t read this image format. Send a screenshot (PNG/JPG) instead.',
  '旧版 .{ext} 读不了，另存成 .{ext}x 再发，或者截图':
    'Old .{ext} files can’t be read. Save as .{ext}x and resend, or send a screenshot.',
  '这种格式 AI 读不了，发出去只会存档。能读的：图片、PDF、Word(.docx)、Excel(.xlsx)、txt/csv':
    'The AI can’t read this format; it will only be archived. Readable: images, PDF, Word (.docx), Excel (.xlsx), txt/csv.',
};
