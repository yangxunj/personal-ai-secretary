import { db } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import MessageBody from '@/components/MessageBody';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate, formatTime, TASK_STATUS } from '@/lib/format';
import { TOPIC_STATUS, parseQuestions } from '@/lib/topic';

export const dynamic = 'force-dynamic';

export default async function TopicDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const t = await db.topic.findUnique({
    where: { id },
    include: {
      tasks: { orderBy: { updatedAt: 'desc' } },
      attachments: { orderBy: { createdAt: 'desc' } },
      messages: { orderBy: { createdAt: 'desc' }, take: 8 },
    },
  });
  if (!t) notFound();

  const qs = parseQuestions(t.questions);
  const open = qs.filter((q) => !q.done);
  const done = qs.filter((q) => q.done);

  return (
    <>
      <PageHeader title={t.title} subtitle={`${TOPIC_STATUS[t.status]} · ${t.category}`} back="/topics" />

      <div className="px-4 py-4 space-y-6">
        {/* 呈现页入口放最上面 —— 这是主人最常点的东西 */}
        {t.page && (
          <a
            href={`/topics/${t.id}/page`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 rounded-2xl p-4 bg-brand-500 text-white active:opacity-80"
          >
            <div>
              <div className="font-medium">打开呈现页</div>
              <div className="text-[12px] opacity-80 mt-0.5">图文并茂的完整版，可以加到主屏幕</div>
            </div>
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </a>
        )}

        {t.body && (
          <section>
            <h2 className="muted text-xs font-medium mb-2 px-1">现状</h2>
            <div className="surface border rounded-2xl p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
              <MessageBody>{t.body}</MessageBody>
            </div>
          </section>
        )}

        {qs.length > 0 && (
          <section>
            <h2 className="muted text-xs font-medium mb-2 px-1">
              还没搞清楚的 · {open.length}/{qs.length}
            </h2>
            <div className="surface border rounded-2xl p-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
              {open.map((q, i) => (
                <div key={`o${i}`} className="flex gap-2.5 text-sm">
                  <span className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400">☐</span>
                  <div>
                    <div className="leading-snug">{q.q}</div>
                    {q.note && <div className="muted text-[12px] mt-0.5 leading-relaxed">{q.note}</div>}
                  </div>
                </div>
              ))}
              {done.map((q, i) => (
                <div key={`d${i}`} className="flex gap-2.5 text-sm muted">
                  <span className="shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400">☑</span>
                  <div>
                    <div className="leading-snug line-through">{q.q}</div>
                    {q.note && <div className="text-[12px] mt-0.5 leading-relaxed">{q.note}</div>}
                  </div>
                </div>
              ))}
              {open.length === 0 && (
                <p className="text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                  都弄清楚了 —— 这个专题可以标成「有结论」了。
                </p>
              )}
            </div>
          </section>
        )}

        {t.tasks.length > 0 && (
          <section>
            <h2 className="muted text-xs font-medium mb-2 px-1">相关任务</h2>
            <div className="space-y-2">
              {t.tasks.map((x) => (
                <Link
                  key={x.id}
                  href="/tasks"
                  className="block surface border rounded-2xl p-3.5 active:opacity-70"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={`text-sm leading-snug ${['done', 'cancelled'].includes(x.status) ? 'line-through muted' : ''}`}>
                      {x.title}
                    </span>
                    <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${TASK_STATUS[x.status].cls}`}>
                      {TASK_STATUS[x.status].label}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {t.attachments.length > 0 && (
          <section>
            {/* 附件放**别人给的东西**（底稿、报价单、照片）。
                我生成的呈现页存在 topic.page 里，不走这里 —— 否则改一次多一份。 */}
            <h2 className="muted text-xs font-medium mb-2 px-1">原始材料</h2>
            <div className="space-y-2">
              {t.attachments.map((a) => (
                <a
                  key={a.id}
                  href={`/api/files/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block surface border rounded-2xl p-3.5 active:opacity-70"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="text-sm leading-snug">{a.filename}</div>
                  {a.note && <div className="muted text-[12px] mt-1 leading-relaxed">{a.note}</div>}
                </a>
              ))}
            </div>
          </section>
        )}

        {t.messages.length > 0 && (
          <section>
            {/* 只读地把相关记录聚过来。**不做输入框** —— 沟通在 Claude Code 里进行，
                平台是结果呈现层，加了输入框它就开始变成聊天软件。 */}
            <h2 className="muted text-xs font-medium mb-2 px-1">相关记录</h2>
            <div className="space-y-2">
              {t.messages.map((m) => (
                <div
                  key={m.id}
                  className="surface border rounded-2xl p-3.5"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="muted text-[11px] mb-1">
                    {m.role === 'user' ? '主人' : '管家'} · {formatTime(m.createdAt)}
                  </div>
                  <div className="text-sm line-clamp-4">
                    <MessageBody>{m.content}</MessageBody>
                  </div>
                </div>
              ))}
            </div>
            <p className="muted text-[11px] mt-2 px-1">
              完整对话在「记录」里 —— 这里只是把跟这个专题有关的聚过来。
            </p>
          </section>
        )}

        <p className="muted text-[11px] text-center pt-2">更新于 {formatDate(t.updatedAt)}</p>
      </div>
    </>
  );
}
