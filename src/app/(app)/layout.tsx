import { redirect } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import SideNav from '@/components/SideNav';
import TestBanner from '@/components/TestBanner';
import { db } from '@/lib/db';
import { sessionIsCurrent } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // middleware 只验得了签名和过期（Edge runtime 读不到数据库）。
  // 密码改了没有只能在这儿验 —— 不验的话，改完密码别人手里那张
  // 还有 30 天才过期的 cookie 照样能用，改了等于没改。
  if (!(await sessionIsCurrent())) redirect('/login');

  const openTasks = await db.task.count({ where: { status: { in: ['todo', 'doing'] } } });
  return (
    // 一套代码两种骨架：窄屏（手机、桌面端窗口拖窄）走底栏 + 单列；
    // 宽屏（lg 起）走左侧栏 + 加宽的内容区。
    //
    // 不做第二套 UI：每个功能写两遍必然漂移，而且要是哪天桌面端开了
    // Tailscale 让手机连回来，手机那套还得用。
    <div className="min-h-dvh">
      <TestBanner />
      <SideNav badge={openTasks} />
      {/* 侧栏是 fixed 的，所以内容区要自己让出那 224px */}
      <div className="lg:pl-56">
        {/* pb-24 是给底栏让位的，宽屏没有底栏就不用留 */}
        {/* 单栏页面封顶宽度，一行字太长读不动；两栏页面（TwoPane 带 data-wide）
            铺满 —— 封顶的话 1920 屏上两侧各空出 270px，左栏又被挤得放不下筛选条。 */}
        <div className="mx-auto max-w-2xl lg:max-w-5xl xl:max-w-6xl lg:has-[[data-wide]]:max-w-none pb-24 lg:pb-10">{children}</div>
      </div>
      <BottomNav badge={openTasks} />
    </div>
  );
}
