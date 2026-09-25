import Link from 'next/link';
import { db } from '@/lib/db';
import { formatDate } from '@/lib/format';

/**
 * 任务总览：逾期几条、这周要办几条、都压在谁身上。
 *
 * **它是弹窗，不占右栏**（见 OverviewDialog）。原来它就摆在宽屏右栏里，
 * 没选中任务时显示总览、选中了显示详情 —— 同一块区域两种性质的内容，
 * 主人一看就说「眼花，不知道看哪里」。现在右栏只要有东西，就一定是任务详情。
 *
 * 每一格都是链接，点下去就是对应的筛选结果 —— 它同时是入口，不只是仪表盘。
 */

const OPEN = ['todo', 'doing', 'blocked'];

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function TaskOverview() {
  const today = startOfToday();
  const all = await db.task.findMany({
    select: { id: true, title: true, status: true, dueDate: true, category: true, owner: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  if (all.length === 0) {
    return (
      <div className="py-16 flex items-center justify-center px-8">
        <p className="muted text-sm text-center leading-relaxed">
          还没有任务。
          <br />
          在对话里说一声，或者点左上角新建。
        </p>
      </div>
    );
  }

  const open = all.filter((t) => OPEN.includes(t.status));
  // 没截止日的返回 +Infinity 而不是 null：这样「逾期」和「七天内」两个判断
  // 都自然不成立，后面排序也不用再判空 —— 用 null 当哨兵，每处都要多一层判断。
  const due = (t: { dueDate: Date | null }) =>
    t.dueDate ? new Date(t.dueDate).setHours(0, 0, 0, 0) : Number.POSITIVE_INFINITY;
  const now = today.getTime();
  const overdue = open.filter((t) => due(t) < now);
  const soon = open.filter((t) => due(t) >= now && due(t) < now + 7 * 86_400_000);
  const noDue = open.filter((t) => !t.dueDate);

  // 按负责人。'' 一格是「没人认领」—— 这不是空档，恰恰是最该被看见的一格：
  // 两个人办事时，没指派的事最容易两边都以为对方在办。
  const byOwner = new Map();
  for (const t of open) byOwner.set(t.owner ?? '', (byOwner.get(t.owner ?? '') ?? 0) + 1);
  const owners = [...byOwner.entries()].sort((a, b) => b[1] - a[1]);

  const byCat = new Map();
  for (const t of open) byCat.set(t.category, (byCat.get(t.category) ?? 0) + 1);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCat = Math.max(1, ...cats.map((c) => c[1]));

  const recent = all.slice(0, 4);

  return (
    <div className="px-6 py-6 space-y-7">
      <div>
        <h2 className="text-[19px] font-semibold tracking-tight">任务总览</h2>
        <p className="muted text-[12px] mt-1">
          共 {all.length} 条，其中 {open.length} 条还没做完
        </p>
      </div>

      {/* 三个数字。每一个都是链接 —— 看到「逾期 2」下一步必然是想看是哪两条。 */}
      <div className="grid grid-cols-3 gap-3">
        <Stat href="/tasks?s=overdue" n={overdue.length} label="已逾期" tone="red" />
        <Stat href="/tasks" n={soon.length} label="7 天内到期" />
        <Stat href="/tasks" n={noDue.length} label="没定期限" />
      </div>

      {/* 宽屏上「逾期」和「这七天」并排 —— 都是「近期要动手的」，一起看 */}
      <div className="grid xl:grid-cols-2 gap-7 xl:gap-8">
      {overdue.length > 0 && (
        <section>
          <h3 className="text-[13px] font-medium text-red-600 dark:text-red-400 mb-2">
            逾期的（最该先处理）
          </h3>
          <div className="space-y-1.5">
            {overdue.slice(0, 4).map((t) => (
              <Row
                key={t.id}
                href={`/tasks/${t.id}?from=${encodeURIComponent('/tasks?s=overdue')}`}
                title={t.title}
                meta={`逾期 ${Math.floor((now - due(t)) / 86_400_000)} 天${t.owner ? ` · ${t.owner}` : ''}`}
                tone="red"
              />
            ))}
          </div>
        </section>
      )}

      {soon.length > 0 && (
        <section>
          <h3 className="text-[13px] font-medium muted mb-2">这七天</h3>
          <div className="space-y-1.5">
            {soon
              .sort((a, b) => due(a) - due(b))
              .slice(0, 5)
              .map((t) => (
                <Row
                  key={t.id}
                  href={`/tasks/${t.id}?from=${encodeURIComponent('/tasks')}`}
                  title={t.title}
                  meta={`${formatDate(t.dueDate)}${t.owner ? ` · ${t.owner}` : ''}`}
                />
              ))}
          </div>
        </section>
      )}
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-3 gap-6 xl:gap-8">
        <section>
          <h3 className="text-[13px] font-medium muted mb-2.5">压在谁身上</h3>
          <div className="space-y-1.5">
            {owners.map(([name, n]) => (
              <Link
                key={name || 'none'}
                href={`/tasks?o=${encodeURIComponent(name || 'none')}`}
                className="flex items-baseline justify-between gap-2 text-[13px] rounded-lg px-2 py-1 -mx-2 hover:bg-brand-500/5 transition"
              >
                <span className={name ? '' : 'muted'}>{name || '没人认领'}</span>
                <span className="muted tabular-nums text-[12px]">{n}</span>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-[13px] font-medium muted mb-2.5">都是些什么事</h3>
          <div className="space-y-1.5">
            {cats.map(([name, n]) => (
              <Link
                key={name}
                href={`/tasks?c=${encodeURIComponent(name)}`}
                className="block rounded-lg px-2 py-1 -mx-2 hover:bg-brand-500/5 transition"
              >
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span>{name}</span>
                  <span className="muted tabular-nums text-[12px]">{n}</span>
                </div>
                {/* 条形是给「哪一类最多」一个体感 —— 光看数字要比大小，要想一下 */}
                <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg)' }}>
                  <div className="h-full bg-brand-500/50" style={{ width: `${(n / maxCat) * 100}%` }} />
                </div>
              </Link>
            ))}
          </div>
        </section>

      <section className="col-span-2 xl:col-span-1">
        <h3 className="text-[13px] font-medium muted mb-2.5">最近加的</h3>
        <div className="space-y-1.5">
          {recent.map((t) => (
            <Row
              key={t.id}
              href={`/tasks/${t.id}?from=${encodeURIComponent('/tasks')}`}
              title={t.title}
              meta={`${formatDate(t.createdAt)}${t.owner ? ` · ${t.owner}` : ''}`}
              dim={!OPEN.includes(t.status)}
            />
          ))}
        </div>
      </section>
      </div>
    </div>
  );
}

function Stat({ href, n, label, tone }: { href: string; n: number; label: string; tone?: 'red' }) {
  const hot = tone === 'red' && n > 0;
  return (
    <Link
      href={href}
      className="surface border rounded-2xl px-4 py-3 block hover:border-brand-500/50 transition"
      style={{ borderColor: hot ? 'rgb(248 113 113 / 0.5)' : 'var(--border)' }}
    >
      <div
        className={`text-[26px] font-semibold tabular-nums leading-none ${
          hot ? 'text-red-600 dark:text-red-400' : n === 0 ? 'muted' : ''
        }`}
      >
        {n}
      </div>
      <div className="muted text-[11px] mt-1.5">{label}</div>
    </Link>
  );
}

function Row({
  href,
  title,
  meta,
  tone,
  dim,
}: {
  href: string;
  title: string;
  meta: string;
  tone?: 'red';
  dim?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 -mx-2 hover:bg-brand-500/5 transition ${dim ? 'opacity-50' : ''}`}
    >
      <span className="text-[13px] min-w-0 truncate">{title}</span>
      <span
        className={`text-[11px] shrink-0 tabular-nums ${
          tone === 'red' ? 'text-red-600 dark:text-red-400' : 'muted'
        }`}
      >
        {meta}
      </span>
    </Link>
  );
}
