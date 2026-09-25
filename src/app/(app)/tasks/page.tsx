import TaskDetail from './TaskDetail';
import TaskList, { firstVisibleTaskId } from './TaskList';
import TwoPane from './TwoPane';

export const dynamic = 'force-dynamic';

/**
 * 任务列表页。
 *
 * 宽屏上右栏**默认显示列表第一条的详情**（邮件客户端那套），那张卡片带高亮。
 * 右栏只放任务详情，别的一概不放 —— 总览挪进了页头的「总览」弹窗。
 * 以前右栏没选中时显示总览、选中了显示详情，同一块区域两种性质的内容，
 * 看的人不知道该看哪里。
 *
 * 窄屏上右栏是 hidden 的，但服务端照样会渲染它，所以自动选中的这条
 * **不标已读**（markRead={false}）—— 否则「管家回了」会在人没看到时被消掉。
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; s?: string; o?: string }>;
}) {
  const { c, s, o } = await searchParams;
  const first = await firstVisibleTaskId({ c, s, o });

  // 详情页「返回」要回到这一屏的筛选，跟卡片链接上的 from 一个意思
  const q = new URLSearchParams();
  if (o) q.set('o', o);
  if (c) q.set('c', c);
  if (s) q.set('s', s);
  const here = q.toString() ? `/tasks?${q}` : '/tasks';

  return (
    <TwoPane
      narrow="list"
      list={<TaskList c={c} s={s} o={o} activeId={first ?? undefined} />}
      detail={
        first ? (
          <TaskDetail id={first} backTo={here} markRead={false} />
        ) : (
          <div className="h-dvh flex items-center justify-center">
            <p className="muted text-sm">这一栏筛下来没有任务</p>
          </div>
        )
      }
    />
  );
}
