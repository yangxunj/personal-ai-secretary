import type { Dict } from '../core';

/** 中文原文 → 英文。key 必须跟 t('…') 里的字符串一字不差。对话页、对话列表、/api/chat */
export const chat: Dict = {
  // ---------- 语音输入 ----------
  语音输入: 'Voice input',
  完成录音: 'Finish recording',
  重试识别: 'Retry transcription',
  '等待麦克风权限…': 'Waiting for microphone permission…',
  '正在录音 {s} / 60 秒': 'Recording {s} / 60 seconds',
  '正在识别语音…': 'Transcribing…',
  '语音输入需要 HTTPS，请使用安全地址或在本机打开': 'Voice input needs HTTPS. Use a secure address or open on this computer.',
  '当前浏览器不支持录音，请使用新版 Chrome、Edge 或 Safari': 'Recording is not supported. Use a recent version of Chrome, Edge or Safari.',
  '无法访问麦克风，请在浏览器和系统设置中允许录音': 'Microphone access was denied. Allow recording in your browser and system settings.',
  '没有找到麦克风，请连接后重试': 'No microphone found. Connect one and try again.',
  '无法启动录音，请检查麦克风是否被占用': 'Could not start recording. Check whether the microphone is in use.',
  '录音中断，请检查麦克风后重试': 'Recording was interrupted. Check the microphone and try again.',
  '录音太短，请重新录音': 'Recording is too short. Please record again.',
  '没有录到声音，请检查麦克风后重试': 'No sound was recorded. Check the microphone and try again.',
  '录音处理失败，请重新录音': 'Could not process the recording. Please record again.',
  '语音识别失败，请重试': 'Transcription failed. Please try again.',
  请求来源无效: 'Invalid request origin',
  '录音格式不支持，请重新录音': 'Unsupported recording format. Please record again.',
  '录音太大，每段最多 60 秒': 'Recording is too large. Each recording can be up to 60 seconds.',
  '录音为空，请重新录音': 'Recording is empty. Please record again.',
  '录音无效或太短，请重新录音': 'Recording is invalid or too short. Please record again.',
  '尚未配置语音识别服务，请在设置中填写语音识别密钥': 'Voice recognition is not configured. Enter a voice API key in Settings.',
  '语音识别密钥被拒绝，请检查密钥和服务区域': 'The voice API key was rejected. Check the key and service region.',
  '语音识别额度不足，请检查服务账户': 'Voice recognition quota is insufficient. Check your service account.',
  '语音识别正忙，请稍后重试': 'Voice recognition is busy. Please try again shortly.',
  '语音识别超时，请重试': 'Transcription timed out. Please try again.',
  '语音识别连接失败，请检查网络后重试': 'Could not connect to voice recognition. Check your network and try again.',
  '语音识别服务暂时不可用，请重试或检查模型配置': 'Voice recognition is unavailable. Try again or check the model configuration.',
  '没有识别到文字，请靠近麦克风重新录音': 'No speech was recognized. Move closer to the microphone and record again.',
  '使用阿里云百炼将录音转成文字，与聊天模型独立。录音会发送给语音服务商，识别后不在本应用保存。': 'Alibaba Cloud Model Studio transcribes recordings independently of the chat model. Audio is sent to the voice provider and is not saved in this app after transcription.',
  '语音配置已保存，请回到聊天录一段话测试': 'Voice settings saved. Return to chat and record a message to test.',
  语音识别地址: 'Voice API base URL',
  语音识别模型: 'Voice model',
  语音识别密钥: 'Voice API key',
  '已配置，留空不改': 'Configured. Leave blank to keep it.',
  保存语音配置: 'Save voice settings',
  '密钥与接口须属于同一服务区域。手机录音需要 HTTPS 地址。': 'The key and endpoint must use the same service region. Mobile recording requires HTTPS.',
  '请检查语音识别地址、模型和密钥，地址必须使用 HTTPS': 'Check the voice API URL, model and key. The URL must use HTTPS.',
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
