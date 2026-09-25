import TaskDetail from '../TaskDetail';
import TaskList from '../TaskList';
import TwoPane from '../TwoPane';

export const dynamic = 'force-dynamic';

/**
 * 任务详情页。正文在 `TaskDetail` 里 —— `/tasks` 宽屏上默认选中第一条时
 * 也要画同一份详情，所以抽了出去。这里只负责解析 `from`、摆骨架。
 */
export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;

  // 只认站内路径：必须以单个 / 开头 —— 挡掉 //evil.com 这种协议相对网址。
  const safeFrom = from && /^\/(?!\/)/.test(from) ? from : null;
  const backTo = safeFrom ?? '/tasks';

  // 宽屏上左边那一列要跟点进来之前长得一模一样，否则一点开详情，
  // 左边就换了一批任务 —— 而筛选条件本来就在 `from` 那串 query 里。
  const q = new URLSearchParams(safeFrom?.split('?')[1] ?? '');

  return (
    <TwoPane
      narrow="detail"
      list={
        <TaskList
          c={q.get('c') ?? undefined}
          s={q.get('s') ?? undefined}
          o={q.get('o') ?? undefined}
          activeId={id}
        />
      }
      detail={<TaskDetail id={id} backTo={backTo} />}
    />
  );
}
