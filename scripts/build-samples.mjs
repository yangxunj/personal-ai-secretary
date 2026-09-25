// 把 samples/pages/ 里的示例页面编成 src/lib/sample-pages.data.ts。
//
//   node scripts/build-samples.mjs
//
// 为什么编成 TS 而不是运行时读目录：桌面端是 Next standalone 产物，运行时
// 读仓库里的任意目录得额外配 outputFileTracing，漏了就是装出来的包里没有示例。
// 编进模块就跟着服务端代码走，一定在。
//
// 改了哪个 .html 或 manifest.json 就重跑一遍。manifest 里的顺序就是页面墙上的顺序。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'samples', 'pages');
const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

const items = manifest.map((m) => {
  for (const k of ['key', 'title', 'summary', 'request', 'category']) {
    if (!m[k]) throw new Error(`manifest 里 ${m.key ?? '?'} 缺 ${k}`);
  }
  const html = readFileSync(path.join(DIR, `${m.key}.html`), 'utf8');
  return { ...m, kind: m.kind ?? 'app', html };
});

const out =
  `// 由 scripts/build-samples.mjs 从 samples/pages/ 生成，别手改。\n` +
  `import type { SamplePage } from './sample-pages';\n\n` +
  `export const SAMPLE_PAGES: SamplePage[] = ${JSON.stringify(items, null, 2)};\n`;
writeFileSync(path.join(ROOT, 'src', 'lib', 'sample-pages.data.ts'), out);
const kb = Math.round(Buffer.byteLength(out) / 1024);
console.log(`${items.length} 个示例 → src/lib/sample-pages.data.ts（${kb}KB）`);
