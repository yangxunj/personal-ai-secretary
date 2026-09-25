'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { destroySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { UPLOAD_DIR, absolutePath } from '@/lib/storage';

// 平台是结果呈现层，不是沟通渠道：记录由管家从 CLI 侧写入，
// 网页上没有发消息的入口。这里只保留主人自己管理数据的操作。

/**
 * 把管家的回复标记为已读。
 * 供页面渲染时直接调用，所以不能带 revalidatePath —— 沟通页本身是
 * force-dynamic，每次访问都会重查，不需要额外失效缓存。
 */
export async function markRead() {
  await db.message.updateMany({
    where: { role: 'secretary', status: 'unread' },
    data: { status: 'read' },
  });
}

/** 快速新建任务 */
export async function createTask(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;
  await db.task.create({
    data: {
      title,
      detail: String(formData.get('detail') ?? '').trim() || null,
      category: String(formData.get('category') ?? '其他'),
      priority: Number(formData.get('priority') ?? 2),
      owner: String(formData.get('owner') ?? '').trim() || null,
      dueDate: formData.get('dueDate') ? new Date(String(formData.get('dueDate'))) : null,
    },
  });
  revalidatePath('/tasks');
}

export async function updateTaskStatus(id: string, status: string) {
  await db.task.update({ where: { id }, data: { status } });
  revalidatePath('/tasks');
}

/**
 * 改派负责人。CLI 一直能改（task:update --owner），但手机上改不了 ——
 * 而「这件事该谁办」恰恰是随手会变的，等下次跟管家说反而会忘。
 * 跟状态切换一个道理，所以做成一样的小按钮。
 */
export async function updateTaskOwner(id: string, owner: string | null) {
  await db.task.update({ where: { id }, data: { owner } });
  revalidatePath('/tasks');
}

/** 新建资料条目 */
export async function createVaultItem(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;
  const labels = formData.getAll('fieldLabel').map(String);
  const values = formData.getAll('fieldValue').map(String);
  const fields = labels
    .map((label, i) => ({ label: label.trim(), value: (values[i] ?? '').trim(), secret: false }))
    .filter((f) => f.label && f.value);

  await db.vaultItem.create({
    data: {
      title,
      category: String(formData.get('category') ?? '其他'),
      fields: JSON.stringify(fields),
      notes: String(formData.get('notes') ?? '').trim() || null,
      tags: String(formData.get('tags') ?? '').trim(),
      sensitive: formData.get('sensitive') === 'on',
    },
  });
  revalidatePath('/vault');
}

export async function deleteVaultItem(id: string) {
  await db.vaultItem.delete({ where: { id } });
  revalidatePath('/vault');
}

export async function logout() {
  await destroySession();
  redirect('/login');
}

/**
 * 在一条任务下留言（留言板，不是聊天）。
 *
 * 这是平台上第三个人机交互入口。为什么是留言板而不是实时聊天：
 * 代办人手上那几件事没有一件需要秒回，
 * 她真正缺的是**回音**——「+ 交结果」交上来的东西，页面上一个字都不显示，
 * 她看不出到底有没有人看过。
 *
 * ★ 留言板和将来的实时聊天**是同一套数据结构**：任务下的一条 Message 线索。
 * 升级时不用重做页面，只是把「回答的人」从管家换成一个自动应答的进程。
 * 所以这一步无论如何都不亏。
 *
 * sender：平台不做登录，没有「谁在问」这个概念，只能发的时候自己选，
 * 默认取任务负责人。答案会因为问的人是谁而不同，所以这个值有用。
 */
export async function postTaskMessage(formData: FormData) {
  // taskId 走隐藏字段而不是 bind：这样整个调用就是一个普通的 FormData，
  // 可以直接用 curl 打一次验证（React 给「函数参数里塞 FormData」用的是
  // $K 引用编码，从外面很难照着构造，出了问题分不清是编码错还是逻辑错）。
  const taskId = String(formData.get('taskId') ?? '').trim();
  const content = String(formData.get('content') ?? '').trim();
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  // 光有附件也算数 —— 代办人经常是「传个截图，没什么好说的」
  if (!taskId || (!content && files.length === 0)) return;
  const sender = String(formData.get('sender') ?? '').trim() || null;

  const msg = await db.message.create({
    data: {
      role: 'user',
      sender,
      content: content || '（没写说明，见附件）',
      status: 'pending',
      taskId,
    },
  });

  // 落盘规则跟 CLI 的 ingestFile 一致（按 年-月 分桶 + 8 位随机前缀），
  // 这样备份、/api/files、文件页都不用改。uploadedBy 写 'user',
  // 跟管家自己收进来的东西区分开。
  if (files.length > 0) {
    const now = new Date();
    const bucket = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await mkdir(path.join(UPLOAD_DIR, bucket), { recursive: true });

    for (const file of files) {
      const base = (file.name || 'upload').replace(/[\\/:*?"<>|]/g, '_');
      const stored = path.join(bucket, `${randomUUID().slice(0, 8)}-${base}`);
      await writeFile(path.join(UPLOAD_DIR, stored), Buffer.from(await file.arrayBuffer()));
      // ⚠ 附件同时挂在消息和任务两边：消息负责「跟着这句话显示」，
      // 任务负责「以后回头翻这件事时还找得到」。只挂一边都会漏。
      await db.attachment.create({
        data: {
          filename: base,
          storedPath: stored.replace(/\\/g, '/'),
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          category: '任务回传',
          note: content || null,
          uploadedBy: 'user',
          messageId: msg.id,
          taskId,
        },
      });
    }
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath('/tasks');
  revalidatePath('/chat');
}

/**
 * 把某条任务下管家的回复标记为已读。详情页渲染时调用。
 *
 * ⚠ 这是在 GET 里写库，严格说不干净。但这个平台就一家人用、页面是
 * force-dynamic、语义又正是「打开就算看过了」—— 为它加一次额外的点击不值当。
 * 上面那个全局 markRead() 用的是同一套做法。
 */
export async function markTaskRepliesRead(taskId: string) {
  await db.message.updateMany({
    where: { taskId, role: 'secretary', status: 'unread' },
    data: { status: 'read' },
  });
}

/**
 * 删掉一个附件（数据库记录 + 磁盘文件），跟 CLI 的 `file:rm` 同一套动作。
 *
 * 加它是因为代办人重复传过同一份文件（同一个 .docx 传了两次、同一份 SDS
 * 占了两个编号），而平台上传完就没有反悔的余地 —— 只能等我下次会话用 CLI 删。
 * **能传就得能删**，否则重复和传错的东西会一直堆着。
 *
 * ⚠ 真删，不是标记删除。所以页面那一侧必须有二次确认（见 AttachmentRow）。
 * 磁盘文件删不掉不算失败：记录清了就行，孤儿文件不会出现在任何页面上。
 */
export async function deleteAttachment(id: string) {
  const f = await db.attachment.findUnique({ where: { id } });
  if (!f) return;
  await db.attachment.delete({ where: { id } });
  try {
    await unlink(absolutePath(f.storedPath));
  } catch {
    // 磁盘上已经不在了，数据库记录清掉就够
  }

  // 顺手清掉因此变空的回传消息：「（没写说明，见附件）」+ 没有附件 = 纯噪音。
  // 只删这一种 —— 用户自己打了字的留言绝不动。
  if (f.messageId) {
    const m = await db.message.findUnique({
      where: { id: f.messageId },
      include: { attachments: { select: { id: true } } },
    });
    if (m && m.attachments.length === 0 && m.content.includes('（没写说明，见附件）')) {
      await db.message.delete({ where: { id: m.id } });
    }
  }

  if (f.taskId) revalidatePath(`/tasks/${f.taskId}`);
  revalidatePath('/tasks');
  revalidatePath('/files');
  revalidatePath('/chat');
}
