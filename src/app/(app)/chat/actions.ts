'use server';

import { revalidatePath } from 'next/cache';
import * as conv from '@/lib/conversations';

/** 对话列表、改名、删除、起标题 —— 逻辑在 lib/conversations.ts，这里只是给客户端组件调的口子 */

export async function listConversations() {
  return conv.listConversations();
}

export async function renameConversation(id: string, title: string) {
  await conv.renameConversation(id, title);
  revalidatePath('/chat', 'layout');
}

export async function deleteConversation(id: string) {
  await conv.deleteConversation(id);
  revalidatePath('/chat', 'layout');
  revalidatePath('/search');
}

export async function titleConversation(id: string, user: string, reply: string) {
  return conv.autoTitle(id, user, reply);
}
