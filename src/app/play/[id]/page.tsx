import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { sessionIsCurrent } from '@/lib/auth';
import PageFrame from '@/components/PageFrame';

/**
 * 「全屏」打开一个 AI 页面：整屏只有那个 iframe，没有导航。
 *
 * 为什么不直接开 /pages/<id>/raw：raw 是裸的沙箱文档，外面没有 PageFrame，
 * pageStore 就只能退化成内存版 —— 读书记录在全屏里记的东西一关就没了。
 * 不放在 (app) 下面是为了不要那套侧栏和底栏，所以登录态得自己验。
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, select: { title: true } });
  return { title: page?.title ?? '' };
}

export default async function Play({ params }: { params: Promise<{ id: string }> }) {
  if (!(await sessionIsCurrent())) redirect('/login');
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, select: { id: true, title: true, updatedAt: true } });
  if (!page) notFound();
  return (
    <PageFrame
      id={page.id}
      src={`/pages/${page.id}/raw?v=${page.updatedAt.getTime()}`}
      title={page.title}
      className="fixed inset-0 w-full h-dvh border-0"
    />
  );
}
