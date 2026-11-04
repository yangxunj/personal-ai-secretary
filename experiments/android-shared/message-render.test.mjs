import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const directory = new URL('artifacts/render-check/', import.meta.url);
await mkdir(directory, { recursive: true });
const source = await readFile(new URL('../../src/components/MessageBody.tsx', import.meta.url), 'utf8');
const compiledFile = new URL('node-message-body.mjs', directory);
await writeFile(compiledFile, ts.transpileModule(source, { fileName: 'MessageBody.tsx', compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
} }).outputText);
const MessageBody = (await import(compiledFile.href + '?check=' + Date.now())).default;
await unlink(compiledFile);

const samples = [
  { name: '中文列表与单换行', markdown: '# 阅读计划\n\n**重点**：保留原文\n第二行中文\n\n- 小王子\n- 三体\n\n1. 先查待办\n2. 再改状态' },
  { name: '围栏代码与长行', markdown: '```js\nconst keep = "<b>不是HTML</b>";\n  const long = "' + 'x'.repeat(240) + '";\n```\n\n`inline code` 和 *斜体*。' },
  { name: '宽表格', markdown: '| ' + Array.from({length: 10}, (_, i) => '栏目' + i).join(' | ') + ' |\n|' + Array(10).fill('---').join('|') + '|\n| ' + Array(10).fill('长内容用于验证表格自身滚动').join(' | ') + ' |' },
  { name: '链接与原始HTML', markdown: '[公开网站](https://example.com)\n\n[危险协议](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>' },
];
const fixtures = samples.map(sample => ({ ...sample, html: renderToStaticMarkup(createElement(MessageBody, null, sample.markdown)) }));
await writeFile(new URL('fixtures.json', directory), JSON.stringify(fixtures, null, 2));

test('the production component renders GFM and preserves line breaks without interpreting raw HTML', () => {
  assert.match(fixtures[0].html, /<strong[^>]*>重点<\/strong>/);
  assert.match(fixtures[0].html, /第二行中文/); assert.match(fixtures[0].html, /<br\/>/);
  assert.match(fixtures[0].html, /<ul/); assert.match(fixtures[0].html, /<ol/);
  assert.match(fixtures[1].html, /<pre[^>]*><code/); assert.match(fixtures[1].html, /\n  const long/);
  assert.match(fixtures[2].html, /overflow-x-auto/); assert.match(fixtures[2].html, /<table/);
  assert.doesNotMatch(fixtures[3].html, /<script|<img|href="javascript:/);
});

test('the APK build uses the exact production message source, generated styles and documented runtime packages', async () => {
  const manifest = JSON.parse(await readFile(new URL('web-dist/build-manifest.json', import.meta.url), 'utf8'));
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(manifest.messageSourceSha256, hash(source));
  assert.equal(manifest.messageBundleSha256, hash(await readFile(new URL('web-dist/messages.js', import.meta.url))));
  const css = await readFile(new URL('web-dist/shared-message.css', import.meta.url), 'utf8');
  assert.equal(manifest.messageStylesSha256, hash(css));
  assert.match(css, /\.overflow-x-auto/); assert.match(css, /\.list-disc/);
  for (const name of ['react', 'react-dom', 'react-markdown', 'remark-gfm']) assert.ok(manifest.bundledPackages.some(pkg => pkg.name === name));
});
