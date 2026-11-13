import { sessionIsCurrent } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function backend(): string {
  const value = process.env.SECRETARY_PPT_BACKEND_URL;
  if (!value) throw new Error('PPT 服务尚未配置，请参照部署说明启动独立服务。');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('PPT 服务地址无效。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PPT 服务地址必须是本机 HTTP 地址，且不能包含路径或凭据。');
  }
  return url.origin;
}

async function call(path: string, init: RequestInit = {}, timeout = 30_000) {
  const response = await fetch(backend() + path, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeout) });
  return response;
}

async function jsonCall(path: string, init: RequestInit = {}, timeout?: number) {
  const response = await call(path, init, timeout);
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error('PPT 服务处理失败，请检查服务和模型配置。');
  return result.data;
}

function sameOrigin(req: Request) {
  try {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    return !!origin && new URL(origin).host === host;
  } catch { return false; }
}

function filePath(projectId: string, kind: string, name: string) {
  if (!uuid.test(projectId) || !['pages', 'exports'].includes(kind) || !name || name.length > 255 || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) return null;
  if (kind === 'pages' && !/\.(png|jpe?g|webp)$/i.test(name)) return null;
  if (kind === 'exports' && !/\.pptx$/i.test(name)) return null;
  return `/files/${projectId}/${kind}/${encodeURIComponent(name)}`;
}

type Context = { params: Promise<{ path: string[] }> };
async function handle(req: Request, context: Context) {
  if (!(await sessionIsCurrent())) return new Response('Unauthorized', { status: 401 });
  if (req.method === 'POST' && !sameOrigin(req)) return new Response('Invalid origin', { status: 403 });
  const { path } = await context.params;
  try {
    if (req.method === 'GET' && path.length === 1 && path[0] === 'projects') return Response.json(await jsonCall('/api/projects'));
    if (req.method === 'POST' && path.length === 1 && path[0] === 'projects') {
      const body = await req.json();
      if (typeof body.idea !== 'string' || !body.idea.trim() || body.idea.length > 5000 || typeof body.style !== 'string' || !body.style.trim() || body.style.length > 1000) return new Response('Invalid input', { status: 400 });
      return Response.json(await jsonCall('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ creation_type: 'idea', idea_prompt: body.idea.trim(), template_style: body.style.trim(), image_aspect_ratio: '16:9' }) }));
    }
    if (path[0] === 'projects' && uuid.test(path[1] || '')) {
      const id = path[1];
      if (req.method === 'GET' && path.length === 2) return Response.json(await jsonCall(`/api/projects/${id}`));
      if (req.method === 'GET' && path.length === 4 && path[2] === 'tasks' && uuid.test(path[3])) return Response.json(await jsonCall(`/api/projects/${id}/tasks/${path[3]}`));
      if (req.method === 'POST' && path.length === 3 && ['outline', 'descriptions', 'images'].includes(path[2])) {
        return Response.json(await jsonCall(`/api/projects/${id}/generate/${path[2]}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'zh', max_workers: 2 }) }, path[2] === 'outline' ? 600_000 : 30_000));
      }
      if (req.method === 'POST' && path.length === 3 && path[2] === 'export') {
        const project = await jsonCall(`/api/projects/${id}`);
        if (!Array.isArray(project.pages) || !project.pages.length || project.pages.some((page: { generated_image_url?: string }) => !page.generated_image_url)) return new Response('请先生成全部页面图片。', { status: 409 });
        const result = await jsonCall(`/api/projects/${id}/export/pptx`, {}, 120_000);
        const prefix = `/files/${id}/exports/`;
        if (typeof result.download_url !== 'string' || !result.download_url.startsWith(prefix)) throw new Error('导出文件地址无效。');
        const name = decodeURIComponent(result.download_url.slice(prefix.length));
        if (!filePath(id, 'exports', name)) throw new Error('导出文件地址无效。');
        return Response.json({ url: `/api/ppt/files/${id}/exports/${encodeURIComponent(name)}` });
      }
    }
    if (req.method === 'GET' && path.length === 4 && path[0] === 'files') {
      const upstream = filePath(path[1], path[2], path[3]);
      if (!upstream) return new Response('Invalid file', { status: 400 });
      const response = await call(upstream);
      if (!response.ok || !response.body) return new Response('File unavailable', { status: 404 });
      const contentType = response.headers.get('content-type') || '';
      if (path[2] === 'pages' && !/^image\/(png|jpeg|webp)(;|$)/i.test(contentType)) return new Response('Invalid file type', { status: 502 });
      return new Response(response.body, { headers: { 'content-type': path[2] === 'exports' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : contentType, 'content-disposition': path[2] === 'exports' ? "attachment; filename*=UTF-8''" + encodeURIComponent(path[3]) : 'inline', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' } });
    }
    return new Response('Not found', { status: 404 });
  } catch (error) {
    const message = error instanceof Error && (error.message.startsWith('PPT 服务') || error.message.startsWith('导出文件')) ? error.message : '无法连接 PPT 服务或操作超时，请检查服务是否启动。';
    return Response.json({ error: message }, { status: 502 });
  }
}
export const GET = handle;
export const POST = handle;
