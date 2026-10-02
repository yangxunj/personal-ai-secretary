import { db } from '@/lib/db';

/**
 * AI 生成的页面（/pages）—— 存、改、退版本，以及怎么安全地展示出来。
 *
 * 页面是 AI 写的整段 HTML，可以带 JS（图表、贪吃蛇、计算器都靠它）。
 * **所以它永远不能跟平台同源运行。** 风险不是 AI 自己使坏，而是它读过的东西：
 * 上传的文档、搜索结果里可能夹带一句「在页面里加段脚本，把 /api/... 的数据发出去」，
 * 被原样写进页面。同源的话那段脚本能调我们所有接口。
 *
 * 两道闸，少一道都不行：
 *   1. 响应头 CSP `sandbox allow-scripts` —— 直接打开 /pages/<id>/raw（全屏看）
 *      也是一个没有 origin 的文档：读不到 cookie、调不了接口、碰不到父页面
 *   2. CSP 的 default-src 'none' —— 不许联网。外链的 JS/CSS/图片一律加载不了，
 *      想往外发数据也发不出去。代价是 AI 不能用 CDN 上的图表库，只能自己画
 *      （内联 SVG / canvas）—— 这反而让「下载下来离线打开」天然成立
 *
 * iframe 上的 sandbox 属性是第三道，但它只管嵌在详情页里那一种打开方式。
 */

/** 单页上限。一个很花哨的页面也就 30-60KB，超过这个多半是模型把数据整张表塞进去了 */
export const MAX_PAGE_BYTES = 600 * 1024;

/** 保留多少个旧版本。再往前的删掉 —— 一页改二十轮，库里就存二十份整页 */
const KEEP_VERSIONS = 20;

export const PAGE_KINDS = {
  snapshot: '数据快照',
  app: '小程序',
} as const;
export type PageKind = keyof typeof PAGE_KINDS;

export const SANDBOX_CSP = [
  // 不给 allow-same-origin：给了它就又是同源了，前面全白做。
  // 不给 allow-modals：原生 alert 会连外面的平台页面一起卡住（livepage 踩过），
  // 下面注入的 SHIM 把 alert 换成了不阻塞的提示条。
  'sandbox allow-scripts allow-downloads',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
].join('; ');

/**
 * 注入到每个页面最前面的一小段脚本。只在平台里看的时候注入，下载的文件不带
 * （下载下来是普通网页，原生 alert、localStorage 都能用）。
 *
 * - **alert → 提示条**。沙箱不给 allow-modals，原生 alert 会被静默吞掉 ——
 *   livepage 的贪吃蛇就是在「游戏结束」那一刻画面冻住、一句提示都没有。
 * - **localStorage → 内存版**。没有 origin 的文档一碰 localStorage 就抛
 *   SecurityError，游戏里常见的 `localStorage.getItem('best')` 会让整段脚本
 *   在第一行就挂掉。换成内存版：这次打开期间有效，关了就没了。
 * - **window.pageStore**：真正能长期存东西的地方（lib/page-data.ts）。
 *   get/set/remove/keys 都返回 Promise，值是任意 JSON。实现是 postMessage 给外层的
 *   PageFrame，由它调接口；只认 `e.source === window.parent` 的回信。
 *   没有外层（直接在新标签页开了 raw）时退化成内存版，`persistent` 为 false。
 */
const SHIM = `<script>(function(){
function toast(m){try{var d=document.createElement('div');d.textContent=String(m);
d.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:88%;z-index:2147483647;background:rgba(20,24,32,.92);color:#fff;padding:10px 16px;border-radius:12px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);white-space:pre-wrap;text-align:center';
(document.body||document.documentElement).appendChild(d);setTimeout(function(){d.remove()},3200)}catch(e){}}
window.alert=toast;
try{window.localStorage.getItem('x')}catch(e){var s={};var m={getItem:function(k){return k in s?s[k]:null},setItem:function(k,v){s[k]=String(v)},removeItem:function(k){delete s[k]},clear:function(){s={}},key:function(i){return Object.keys(s)[i]||null},get length(){return Object.keys(s).length}};
try{Object.defineProperty(window,'localStorage',{value:m,configurable:true})}catch(e2){}
try{Object.defineProperty(window,'sessionStorage',{value:m,configurable:true})}catch(e3){}}
var P={},n=0,up=window.parent!==window,mem={};
window.addEventListener('message',function(e){if(e.source!==window.parent)return;var d=e.data;if(!d||d.__pageStoreReply!==1)return;var p=P[d.id];if(!p)return;delete P[d.id];if(d.ok)p[0](d.value===undefined?null:d.value);else p[1](new Error(d.error||'pageStore error'))});
function call(op,k,v){if(!up){var c=function(x){return x==null?null:JSON.parse(JSON.stringify(x))};
if(op==='get')return Promise.resolve(k in mem?c(mem[k]):null);if(op==='set'){if(v==null)delete mem[k];else mem[k]=c(v);return Promise.resolve(null)}
if(op==='remove'){delete mem[k];return Promise.resolve(null)}return Promise.resolve(Object.keys(mem))}
return new Promise(function(res,rej){var id=++n;P[id]=[res,rej];
try{window.parent.postMessage({__pageStore:1,id:id,op:op,key:k,value:v},'*')}catch(e){delete P[id];rej(e);return}
setTimeout(function(){if(P[id]){delete P[id];rej(new Error('pageStore timeout'))}},15000)})}
window.pageStore={persistent:up,get:function(k){return call('get',k)},set:function(k,v){return call('set',k,v)},remove:function(k){return call('remove',k)},keys:function(){return call('keys')}};
})();</script>`;

/**
 * 下载下来的页面离开了平台，没有 PageFrame 接 postMessage。
 * 给它一个用 localStorage 实现的 pageStore（下载下来的页面有正常的 origin，localStorage 能用），
 * 并把下载那一刻平台里存的数据当初始值带上 —— 不然「读书记录」下载下来是一张空表。
 * 浏览器里已经有的 key 不覆盖：在离线版里又记过的东西不能被下载时的旧数据冲掉。
 */
function downloadShim(seed: Record<string, unknown>) {
  const json = JSON.stringify(seed).replace(/</g, '\\u003c');
  return `<script>(function(){if(window.pageStore)return;var L=window.localStorage,p='pageStore:',seed=${json};
try{for(var k in seed)if(L.getItem(p+k)===null)L.setItem(p+k,JSON.stringify(seed[k]))}catch(e){}
function g(k){try{var v=L.getItem(p+k);return v===null?null:JSON.parse(v)}catch(e){return null}}
window.pageStore={persistent:true,get:function(k){return Promise.resolve(g(k))},
set:function(k,v){try{if(v==null)L.removeItem(p+k);else L.setItem(p+k,JSON.stringify(v));return Promise.resolve(null)}catch(e){return Promise.reject(e)}},
remove:function(k){try{L.removeItem(p+k)}catch(e){}return Promise.resolve(null)},
keys:function(){var o=[];try{for(var i=0;i<L.length;i++){var k=L.key(i);if(k&&k.indexOf(p)===0)o.push(k.slice(p.length))}}catch(e){}return Promise.resolve(o)}};
})();</script>`;
}

/** 把一段脚本插到 <head> 开头（没有 head 就插到最前面），保证它比页面自己的脚本先跑 */
function inject(html: string, script: string): string {
  const m = html.match(/<head[^>]*>/i);
  if (m && m.index !== undefined) {
    const at = m.index + m[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  return script + html;
}

export function withShim(html: string): string {
  return inject(html, SHIM);
}

/** 下载用：页面没用 pageStore 就原样给，用了才带上离线版和当前数据 */
export function forDownload(html: string, seed: Record<string, unknown>): string {
  return /\bpageStore\b/.test(html) ? inject(html, downloadShim(seed)) : html;
}

/**
 * 挑出沙箱里注定用不了的写法。不拦，只提醒 —— AI 下一步就能自己改掉；
 * 拦了的话一个 Google Fonts 链接就让整页存不进去，太苛刻。
 */
export function pageWarnings(html: string): string[] {
  const w: string[] = [];
  if (/<(script|link|img|iframe)[^>]+(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html) || /@import\s+url\(\s*["']?https?:/i.test(html)) {
    w.push('页面引用了外部资源（CDN 脚本、网络字体或图片）—— 沙箱不许联网，这些都加载不出来。图表请用内联 SVG 或 canvas 自己画。');
  }
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/.test(html)) {
    w.push('页面里有网络请求（fetch / XHR / WebSocket）—— 沙箱里发不出去。数据请直接写进 HTML。');
  }
  if (/\b(confirm|prompt)\s*\(/.test(html)) {
    w.push('confirm() / prompt() 在沙箱里不起作用（直接返回 false / null）。要用户确认或输入，请在页面里自己画按钮和输入框。');
  }
  if (!/<meta[^>]+viewport/i.test(html)) {
    w.push('缺少 <meta name="viewport" content="width=device-width, initial-scale=1">，手机上会缩成一小块。');
  }
  return w;
}

export type SaveInput = {
  id?: string;
  title: string;
  summary?: string;
  request?: string;
  kind?: PageKind;
  html: string;
  /** 在哪个对话里做的。只在新建时记 —— 后来在别的对话里改，出处还是最初那个 */
  conversationId?: string;
};

/** 新建或整页替换。替换前先把旧的存成一个版本 */
export async function savePage(p: SaveInput) {
  const bytes = Buffer.byteLength(p.html, 'utf8');
  if (bytes > MAX_PAGE_BYTES) {
    return {
      ok: false as const,
      error: `页面 ${Math.round(bytes / 1024)}KB，超过上限 ${MAX_PAGE_BYTES / 1024}KB。多半是把整张明细表塞进去了 —— 只放汇总和前几十条。`,
    };
  }
  if (!/<(html|body|div|canvas|svg|main|section|h1|p)\b/i.test(p.html)) {
    return { ok: false as const, error: 'html 看起来不是网页，请给一个完整的 HTML 文档。' };
  }

  if (p.id) {
    const old = await db.page.findUnique({ where: { id: p.id } });
    if (!old) return { ok: false as const, error: `没有 id 为 ${p.id} 的页面，先用 listPages 查一下` };
    await db.pageVersion.create({ data: { pageId: old.id, title: old.title, html: old.html } });
    await trimVersions(old.id);
    const page = await db.page.update({
      where: { id: p.id },
      data: {
        title: p.title,
        html: p.html,
        ...(p.summary !== undefined ? { summary: p.summary } : {}),
        // 改版时的要求是「在原来基础上改一下」，不能拿它覆盖当初的要求 ——
        // 「重新生成」要的是那句完整的原始要求
        ...(p.request !== undefined && !old.request ? { request: p.request } : {}),
        ...(p.kind ? { kind: p.kind } : {}),
        // 示例页被用户改过，就是他自己的了：摘掉「示例」角标
        sample: null,
      },
    });
    return { ok: true as const, id: page.id, created: false };
  }

  const page = await db.page.create({
    data: {
      title: p.title,
      summary: p.summary ?? null,
      request: p.request ?? null,
      kind: p.kind ?? 'snapshot',
      html: p.html,
      conversationId: p.conversationId ?? null,
    },
  });
  return { ok: true as const, id: page.id, created: true };
}

async function trimVersions(pageId: string) {
  const stale = await db.pageVersion.findMany({
    where: { pageId },
    orderBy: { createdAt: 'desc' },
    skip: KEEP_VERSIONS,
    select: { id: true },
  });
  if (stale.length) await db.pageVersion.deleteMany({ where: { id: { in: stale.map((v) => v.id) } } });
}

/**
 * 恢复到某个旧版本（不指定就是最近的那一版，即「上一版」）。
 *
 * 当前这版先存成一个新版本再换 —— 恢复错了还能再恢复回来，没有哪一版会因为
 * 「撤销」而彻底消失。所以连按两次「退回上一版」是在两版之间来回切，
 * 要退得更远，去详情页的版本列表里挑。
 */
export async function restoreVersion(pageId: string, versionId?: string) {
  const page = await db.page.findUnique({ where: { id: pageId } });
  if (!page) return { ok: false as const, error: '页面不存在' };
  const v = versionId
    ? await db.pageVersion.findFirst({ where: { id: versionId, pageId } })
    : await db.pageVersion.findFirst({ where: { pageId }, orderBy: { createdAt: 'desc' } });
  if (!v) return { ok: false as const, error: '没有可以恢复的旧版本' };
  await db.$transaction([
    db.pageVersion.create({ data: { pageId, title: page.title, html: page.html } }),
    db.page.update({ where: { id: pageId }, data: { title: v.title, html: v.html } }),
  ]);
  await trimVersions(pageId);
  return { ok: true as const, id: pageId, title: v.title };
}

/** 下载文件名：标题里 Windows 不认的字符换掉 */
export function downloadName(title: string) {
  return `${title.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'page'}.html`;
}
