import { db } from '@/lib/db';

/**
 * 页面自己的小存储（PageData 表）—— 页面脚本通过 window.pageStore 读写，
 * AI 通过 getPageData / setPageData 工具读写，两边看到的是同一份。
 *
 * 页面怎么够得着这里：沙箱页面没有 origin、调不了接口，只能 postMessage 给
 * 外面的平台页面（components/PageFrame.tsx），由它带着**自己知道的** pageId
 * 来调 /api/pages/<id>/data。页面脚本改不了 pageId，所以只能碰自己这一份。
 *
 * 值一律是 JSON。上限是防一个写坏了的页面（死循环里 set）把库撑爆，
 * 正常的读书记录、打卡表离这些数差得远。
 */

export const KEY_RE = /^[\w.\-:一-鿿]{1,100}$/;
export const MAX_VALUE_BYTES = 512 * 1024;
export const MAX_KEYS = 200;
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function badKey(key: unknown): string | null {
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    return 'key 只能用字母、数字、汉字和 _ . - :，最长 100 个字符';
  }
  return null;
}

export async function getData(pageId: string, key: string): Promise<Result<unknown>> {
  const e = badKey(key);
  if (e) return { ok: false, error: e };
  const row = await db.pageData.findUnique({ where: { pageId_key: { pageId, key } } });
  if (!row) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(row.value) };
  } catch {
    return { ok: true, value: null };
  }
}

export async function setData(pageId: string, key: string, value: unknown): Promise<Result<null>> {
  const e = badKey(key);
  if (e) return { ok: false, error: e };
  if (value === undefined || value === null) return removeData(pageId, key);

  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return { ok: false, error: '值不能转成 JSON' };
  }
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_VALUE_BYTES) {
    return { ok: false, error: `单个值 ${Math.round(bytes / 1024)}KB，超过上限 ${MAX_VALUE_BYTES / 1024}KB` };
  }

  const page = await db.page.findUnique({ where: { id: pageId }, select: { id: true } });
  if (!page) return { ok: false, error: '页面不存在' };

  const rows = await db.pageData.findMany({ where: { pageId }, select: { key: true, value: true } });
  const others = rows.filter((r) => r.key !== key);
  if (others.length >= MAX_KEYS) return { ok: false, error: `这个页面已经存了 ${MAX_KEYS} 个 key，到上限了` };
  const total = others.reduce((n, r) => n + Buffer.byteLength(r.value, 'utf8'), 0) + bytes;
  if (total > MAX_TOTAL_BYTES) {
    return { ok: false, error: `这个页面的数据总共会到 ${Math.round(total / 1024)}KB，超过上限 ${MAX_TOTAL_BYTES / 1024 / 1024}MB` };
  }

  await db.pageData.upsert({
    where: { pageId_key: { pageId, key } },
    create: { pageId, key, value: json },
    update: { value: json },
  });
  return { ok: true, value: null };
}

export async function removeData(pageId: string, key: string): Promise<Result<null>> {
  const e = badKey(key);
  if (e) return { ok: false, error: e };
  await db.pageData.deleteMany({ where: { pageId, key } });
  return { ok: true, value: null };
}

export async function listKeys(pageId: string) {
  const rows = await db.pageData.findMany({
    where: { pageId },
    orderBy: { key: 'asc' },
    select: { key: true, value: true, updatedAt: true },
  });
  return rows.map((r) => ({ key: r.key, bytes: Buffer.byteLength(r.value, 'utf8'), updatedAt: r.updatedAt }));
}

/**
 * 给 AI 看的整份数据：每个 key 的值都解析出来，太长的截断。
 * 「读书记录里今年读了几本」这种问题靠它回答。
 */
export async function dumpForModel(pageId: string, maxChars = 60_000) {
  const rows = await db.pageData.findMany({ where: { pageId }, orderBy: { key: 'asc' } });
  let used = 0;
  const out: Record<string, unknown> = {};
  const truncated: string[] = [];
  for (const r of rows) {
    if (used + r.value.length > maxChars) {
      truncated.push(r.key);
      continue;
    }
    used += r.value.length;
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return { data: out, truncated };
}

/**
 * 页面自己声明的数据格式（写页面时要求放进 <script type="application/json" id="pagestore-schema">，
 * 见 lib/page-builder.ts）。页面还没存过数据时，AI 只能靠它知道该往哪个 key 写、每条长什么样 ——
 * 不然它只能猜字段名，猜错了页面上就显示不出来。
 */
export function declaredSchema(html: string): unknown {
  const m = html.match(/<script[^>]*id=["']pagestore-schema["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** 改页面时给 AI 一个提示：现在存着哪些 key、每个长什么样（只看形状，不给全部内容） */
export async function shapeSummary(pageId: string) {
  const rows = await db.pageData.findMany({ where: { pageId }, orderBy: { key: 'asc' } });
  return rows.map((r) => {
    let sample: string;
    try {
      const v = JSON.parse(r.value);
      const first = Array.isArray(v) ? v[0] : v;
      sample = JSON.stringify(first)?.slice(0, 300) ?? '';
      if (Array.isArray(v)) sample = `数组，${v.length} 条，第一条：${sample}`;
    } catch {
      sample = r.value.slice(0, 300);
    }
    return { key: r.key, sample };
  });
}
