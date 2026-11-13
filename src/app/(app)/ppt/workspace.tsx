'use client';

import { useCallback, useEffect, useState } from 'react';

type Page = { page_id: string; generated_image_url: string | null; outline_content: { title?: string } | null; description_content: unknown };
type Project = { project_id: string; project_title: string | null; idea_prompt: string; status: string; pages?: Page[] };
type Task = { task_id: string; status: string; progress?: { completed?: number; total?: number; failed?: number }; error_message?: string };
const storageKey = 'secretary-ppt-active-task';
const button = 'rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50';
const secondary = 'rounded-lg border px-4 py-2 text-sm disabled:opacity-50';

async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch('/api/ppt/' + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    const error = contentType.includes('json') ? (await response.json()).error : await response.text();
    throw new Error(error || '请求失败，请稍后重试。');
  }
  return response.json();
}

function imageUrl(url: string, projectId: string) {
  const prefix = `/files/${projectId}/pages/`;
  if (!url.startsWith(prefix)) return '';
  return `/api/ppt/files/${projectId}/pages/${encodeURIComponent(url.slice(prefix.length))}`;
}

export default function PptWorkspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [idea, setIdea] = useState('');
  const [style, setStyle] = useState('适合课堂教学的清晰、专业、图文结合的幻灯片');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState<{ projectId: string; taskId: string; stage: string } | null>(null);
  const [task, setTask] = useState<Task | null>(null);

  const refreshList = useCallback(async () => { const data = await api('projects'); setProjects(data.projects || []); }, []);
  const open = useCallback(async (id: string) => { setProject(await api(`projects/${id}`)); }, []);
  useEffect(() => {
    refreshList().catch(e => setError(e.message));
    try { const saved = localStorage.getItem(storageKey); if (saved) { const restored = JSON.parse(saved); setActive(restored); open(restored.projectId).catch(e => setError(e.message)); } } catch { localStorage.removeItem(storageKey); }
  }, [refreshList, open]);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const current: Task = await api(`projects/${active!.projectId}/tasks/${active!.taskId}`);
        if (stopped) return;
        setTask(current);
        if (current.status === 'COMPLETED' || current.status === 'FAILED') {
          localStorage.removeItem(storageKey); setActive(null);
          if (current.status === 'FAILED' || (current.progress?.failed || 0) > 0) setError('生成未完全成功，请检查模型配置后重试。');
          await open(active!.projectId); await refreshList();
        } else timer = setTimeout(poll, 2500);
      } catch (e) { if (!stopped) { setError(e instanceof Error ? e.message : '查询进度失败'); timer = setTimeout(poll, 5000); } }
    }
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, open, refreshList]);

  async function run(label: string, fn: () => Promise<void>) {
    setError(''); setBusy(label);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(''); }
  }
  async function create() {
    await run('创建项目', async () => { const data = await api('projects', 'POST', { idea, style }); await refreshList(); await open(data.project_id); setIdea(''); });
  }
  async function stage(name: 'outline' | 'descriptions' | 'images', label: string) {
    if (!project) return;
    await run(label, async () => {
      const result = await api(`projects/${project.project_id}/${name}`, 'POST');
      if (result.task_id) {
        const next = { projectId: project.project_id, taskId: result.task_id, stage: label };
        localStorage.setItem(storageKey, JSON.stringify(next)); setActive(next); setTask(null);
      } else { await open(project.project_id); await refreshList(); }
    });
  }
  async function exportPpt() {
    if (!project) return;
    await run('导出', async () => { const data = await api(`projects/${project.project_id}/export`, 'POST'); window.location.assign(data.url); });
  }
  const pages = project?.pages || [];
  const locked = !!busy || !!active;
  return <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
    <p className="muted text-sm">输入教学主题，依次生成大纲、页面描述和图片。导出的是图片型 PPT，文字不能单独编辑。</p>
    {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    <div className="grid gap-5 md:grid-cols-[19rem_1fr]">
      <aside className="space-y-4">
        <section className="surface rounded-xl border p-4 space-y-3">
          <h2 className="font-semibold">新建幻灯片</h2>
          <label className="block text-sm">主题与要求<textarea value={idea} onChange={e => setIdea(e.target.value)} rows={4} maxLength={5000} placeholder="例如：为小学五年级讲解水循环，制作 5 页课件" className="mt-1 w-full rounded-lg border bg-transparent p-2" /></label>
          <label className="block text-sm">视觉风格<textarea value={style} onChange={e => setStyle(e.target.value)} rows={3} maxLength={1000} className="mt-1 w-full rounded-lg border bg-transparent p-2" /></label>
          <button className={button} disabled={locked || !idea.trim() || !style.trim()} onClick={create}>创建项目</button>
        </section>
        <section className="surface rounded-xl border p-4 space-y-2"><h2 className="font-semibold">我的项目</h2>
          {projects.length === 0 && <p className="muted text-sm">暂无项目</p>}
          {projects.map(p => <button key={p.project_id} className="block w-full rounded-lg border p-2 text-left text-sm hover:border-brand-500" onClick={() => run('打开项目', () => open(p.project_id))} disabled={locked}>{p.project_title || p.idea_prompt || '未命名项目'}</button>)}
        </section>
      </aside>
      <section className="surface min-h-80 rounded-xl border p-4 md:p-5">
        {!project ? <p className="muted text-sm">创建或选择一个项目开始制作。</p> : <div className="space-y-4">
          <div><h2 className="text-lg font-semibold">{project.project_title || project.idea_prompt || '未命名项目'}</h2><p className="muted mt-1 text-sm">项目状态：{project.status} · {pages.length} 页</p></div>
          <div className="flex flex-wrap gap-2">
            <button className={secondary} disabled={locked || pages.length > 0} onClick={() => stage('outline', '生成大纲')}>1. 生成大纲</button>
            <button className={secondary} disabled={locked || !pages.length} onClick={() => stage('descriptions', '生成页面描述')}>2. 生成页面描述</button>
            <button className={secondary} disabled={locked || !pages.length || pages.some(p => !p.description_content)} onClick={() => stage('images', '生成页面图片')}>3. 生成图片</button>
            <button className={button} disabled={locked || !pages.length || pages.some(p => !p.generated_image_url)} onClick={exportPpt}>导出 PPTX</button>
          </div>
          {(busy || active) && <div role="status" className="space-y-2 text-sm"><p>{busy || active?.stage}中，请稍候… {task?.progress?.total ? `${task.progress.completed || 0}/${task.progress.total} 页` : ''}</p>{active && <button className={secondary} onClick={() => { localStorage.removeItem(storageKey); setActive(null); setTask(null); }}>停止查看进度</button>}{active && <p className="muted text-xs">停止查看不会取消后台任务；请确认任务已结束后再重试，避免重复生成。</p>}</div>}
          <p className="muted text-xs">大纲生成可能需要几分钟，请等待完成；图片与描述任务可在刷新后继续查看进度。</p>
          <div className="grid gap-4 sm:grid-cols-2">{pages.map((page, i) => <article key={page.page_id} className="overflow-hidden rounded-lg border"><div className="bg-black/5">{page.generated_image_url && imageUrl(page.generated_image_url, project.project_id) ? <img src={imageUrl(page.generated_image_url, project.project_id)} alt={`第 ${i + 1} 页`} className="aspect-video w-full object-contain" /> : <div className="flex aspect-video items-center justify-center text-sm muted">尚未生成图片</div>}</div><p className="p-3 text-sm">{i + 1}. {page.outline_content?.title || '未命名页面'}</p></article>)}</div>
        </div>}
      </section>
    </div>
  </div>;
}
