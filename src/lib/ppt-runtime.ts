import { randomBytes } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { getAiConfig } from '@/lib/ai-config';
import { getPptOpenRouterKey } from '@/lib/ppt-settings';
import { assertManagedPptTarget, sendPptRuntimeConfig } from '@/lib/ppt-runtime-transport.mjs';

export function pptBackend(): string {
  const value = process.env.SECRETARY_PPT_BACKEND_URL;
  if (!value) throw new Error('PPT 服务尚未配置，请参照部署说明启动项目内引擎。');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('PPT 服务地址无效。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PPT 服务地址必须是本机 HTTP 地址，且不能包含路径或凭据。');
  }
  return url.origin;
}

export function usesManagedPptAddress(): boolean {
  try { return new URL(pptBackend()).port === (process.env.SECRETARY_PPT_ENGINE_PORT || '15398'); }
  catch { return false; }
}

async function controlToken(): Promise<string> {
  const configured = process.env.SECRETARY_PPT_ENGINE_DATA_DIR;
  if (configured && !path.isAbsolute(configured)) throw new Error('PPT 服务的数据目录必须使用绝对路径。');
  const instance = path.join(path.resolve(configured || './data/ppt-engine'), 'instance');
  const dbFile = path.join(instance, 'database.db');
  try { if (!(await stat(dbFile)).isFile()) throw new Error(); } catch { throw new Error('PPT 服务尚未启动或数据目录不匹配。'); }
  const tokenFile = path.join(instance, '.secretary-control-token');
  try {
    const file = await open(tokenFile, 'wx', 0o600);
    try { await file.writeFile(randomBytes(32).toString('hex'), 'ascii'); } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('PPT 服务控制文件不可用。');
  }
  // Another local server process may have exclusively created the file but not yet finished writing it.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const token = (await readFile(tokenFile, 'ascii')).trim();
      if (/^[a-f0-9]{64}$/.test(token)) return token;
    } catch { /* a concurrent creator may still be writing */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('PPT 服务控制文件无效。');
}

/** Apply user-selected settings only to the matching, authenticated managed engine. */
export async function preparePptGeneration(base: string): Promise<void> {
  const imageKey = await getPptOpenRouterKey();
  if (!imageKey) return; // Existing installations keep their own engine settings until explicitly configured here.
  const ai = await getAiConfig();
  if (!ai.apiKey || !ai.baseUrl || !ai.model) throw new Error('PPT 服务需要先在 AI 设置中配置可用的对话 API 地址、模型和密钥。');
  try {
    const url = new URL(ai.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { throw new Error('PPT 服务使用的对话 API 地址无效，请检查 AI 设置。'); }
  const expectedPort = process.env.SECRETARY_PPT_ENGINE_PORT || '15398';
  assertManagedPptTarget(base, expectedPort);
  const token = await controlToken();
  await sendPptRuntimeConfig(base, token, { textBaseUrl: ai.baseUrl, textKey: ai.apiKey, textModel: ai.model, imageKey });
}
