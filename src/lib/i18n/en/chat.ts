import type { Dict } from '../core';

/** 中文原文 → 英文。key 必须跟 t('…') 里的字符串一字不差。对话页、对话列表、/api/chat */
export const chat: Dict = {
  // ---------- 对话页（chat/[[...id]]/page.tsx） ----------
  '定位到这一条 · 这个对话共 {n} 条': 'Jumped to this message · {n} {n|message|messages} in this chat',
  '最近更新 {time}': 'Updated {time}',
  想到什么说什么: 'Say whatever comes to mind',
  '跟我说话就行 —— 要记的事、要存的号码、要查的东西。':
    'Just talk to me: things to remember, numbers to keep, stuff to look up.',
  '比如「下周三前把车险续了」「记住我的招行卡号是 6225…」「还有什么没办」。':
    'For example: "Renew the car insurance before next Wednesday", "Remember my bank card number is 6225…", "What\'s still pending?"',
  '一件事一个对话，聊得清楚些；存下的资料、任务、页面在哪个对话里都查得到。':
    'One topic per chat keeps things clear. Saved vault items, tasks and pages are available from every chat.',

  // ---------- 页头、对话菜单（ChatHeader） ----------
  对话列表: 'Chats',
  新对话: 'New chat',
  回到最新: 'Back to latest',
  对话操作: 'Chat actions',
  改个名字: 'Rename',
  删除这个对话: 'Delete this chat',
  '聊天记录会删掉。在对话里建的任务、存的资料、传的文件、做的页面都还在。':
    'The messages will be deleted. Tasks, vault items, files and pages created in this chat will stay.',
  // 「删除中…」「确定删除」在 content.ts（附件、页面删除也用）

  // ---------- 对话列表（ConversationList） ----------
  还没有对话: 'No chats yet',
  '7 天内': 'Previous 7 days',
  '30 天内': 'Previous 30 days',
  更早: 'Older',

  // ---------- 对话本身（Chat.tsx） ----------
  // 工具卡片：告诉用户 AI 刚动了什么
  记下待办: 'Added a to-do',
  翻了翻待办: 'Checked tasks',
  更新待办: 'Updated a task',
  存进资料库: 'Saved to vault',
  查资料库: 'Searched vault',
  留了个档: 'Saved a note',
  归档文件: 'Filed a document',
  读账单入库: 'Imported a statement',
  读体检报告入库: 'Imported a checkup report',
  查账: 'Checked finances',
  查体检记录: 'Checked health records',
  查保单: 'Checked policies',
  翻了翻页面: 'Browsed pages',
  取回页面: 'Opened a page',
  做页面: 'Made a page',
  读页面里的数据: 'Read the page’s data',
  往页面里写数据: 'Wrote to the page’s data',
  '· 正在写，已写 {n} 字 · {s} 秒': '· writing, {n} chars · {s}s',
  '· 正在构思 · {s} 秒': '· thinking · {s}s',
  退回上一版: 'Restored previous version',
  '打开页面 →': 'Open page →',
  收起思考过程: 'Hide reasoning',
  '思考过程（{n} 字）': 'Reasoning ({n} {n|char|chars})',
  '{names} 超过 10MB，先压一下再传': '{names}: over 10 MB. Please compress before uploading.',
  // 只传了附件没配话时替用户说的那句，会出现在对话记录里
  看看这个: 'Take a look at this',
  '还有 {n} 条更早的 · 查看更早': '{n} earlier {n|message|messages} · Show earlier',
  以下是本次对话: 'This session',
  图片: 'Image',
  '出错了：': 'Something went wrong: ',
  刷新重试: 'Reload and retry',
  移除: 'Remove',
  'AI 读不了': "AI can't read",
  添加文件: 'Add files',
  '说说这是什么（可留空）…': 'Say what this is (optional)…',
  '跟我说点什么，也可以传张图…': 'Tell me something, or drop in a picture…',
  停止: 'Stop',
  发送: 'Send',
  '关联任务：': 'Task: ',
  '↑ 以上的对话 AI 只记得摘要': '↑ The AI only remembers a summary of the chat above',
  看摘要: 'View summary',
  '{time} 整理': 'Summarized {time}',
  '对话太长时，早期内容会自动整理成这份摘要，之后 AI 记得的是「摘要 + 这条线以下的原文」':
    'When a chat gets long, earlier messages are condensed into this summary. From then on the AI remembers "the summary + the messages below this line".',
  // 选文件时「AI 读不了」的原因（lib/file-support.ts）在 content.ts

  // ---------- /api/chat（route.ts） ----------
  未授权: 'Unauthorized',
  '还没设置模型。打开「设置」（宽屏在侧栏左下角），填好 API Key 再回来。':
    'No AI model is set up yet. Open Settings (bottom left of the sidebar on wide screens), enter an API key, then come back.',
  没有消息: 'No message',
  '对话 id 不对': 'Invalid chat id',
  // 这两句存进对话记录，页面上看得见
  '［上传了 {n} 个文件］': '[Uploaded {n} {n|file|files}]',
  '（已处理）': '(Done)',
  模型调用出错: 'The model call failed',

  // ---------- 读账单的余额勾稽（lib/agent-tools.ts importBill），工具卡片和账单页上显示 ----------
  '余额对不上：期初 {opening} + 进账 {credit} − 出账 {debit} = {expected}，但账单写的期末是 {closing}，差 {diff}。多半是有笔交易读漏了或金额读错了':
    "Balances don't match: opening {opening} + in {credit} − out {debit} = {expected}, but the statement's closing balance is {closing}, off by {diff}. Most likely a transaction was missed or an amount misread.",
  '账单没给期初/期末余额，这次没做余额勾稽 —— 金额对不对没法自动验':
    "The statement has no opening/closing balance, so the amounts couldn't be checked automatically.",
};
