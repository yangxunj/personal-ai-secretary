'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { restoreVersion } from '@/lib/pages';

/**
 * 页面上用户自己能做的两件事：退回旧版本、删掉。
 * 做页面、改页面仍然在对话里跟 AI 说 —— 这里不长出编辑器。
 */

export async function restorePage(pageId: string, versionId?: string) {
  await restoreVersion(pageId, versionId);
  revalidatePath('/pages');
  revalidatePath(`/pages/${pageId}`);
}

export async function deletePage(id: string) {
  // 历史版本跟着 onDelete: Cascade 一起走
  await db.page.delete({ where: { id } }).catch(() => null);
  revalidatePath('/pages');
  redirect('/pages');
}
