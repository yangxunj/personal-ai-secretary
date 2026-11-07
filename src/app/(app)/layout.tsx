import { redirect } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import SideNav from '@/components/SideNav';
import TestBanner from '@/components/TestBanner';
import { db } from '@/lib/db';
import { sessionIsCurrent } from '@/lib/auth';
import { listCollections } from '@/lib/collections/service';
import AppShell from '@/components/navigation/shared/AppShell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // middleware 只验得了签名和过期（Edge runtime 读不到数据库）。
  // 密码改了没有只能在这儿验 —— 不验的话，改完密码别人手里那张
  // 还有 30 天才过期的 cookie 照样能用，改了等于没改。
  if (!(await sessionIsCurrent())) redirect('/login');

  const [openTasks, collections] = await Promise.all([db.task.count({ where: { status: { in: ['todo', 'doing'] } } }), listCollections()]);
  return (
    // 一套代码两种骨架：窄屏（手机、桌面端窗口拖窄）走底栏 + 单列；
    // 宽屏（lg 起）走左侧栏 + 加宽的内容区。
    //
    // 不做第二套 UI：每个功能写两遍必然漂移，而且要是哪天桌面端开了
    // Tailscale 让手机连回来，手机那套还得用。
    <AppShell banner={<TestBanner />}
      side={<SideNav badge={openTasks} collections={collections.map(c => ({ id: c.id, title: c.definition.title }))} />}
      bottom={<BottomNav badge={openTasks} />}>
      {children}
    </AppShell>
  );
}
