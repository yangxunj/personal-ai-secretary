#!/usr/bin/env node
/**
 * 多语言对账：
 *   1. 代码里所有 t('…') 的 key，英文词典里有没有 —— 没有就是英文界面上漏出中文
 *   2. 去掉注释和 t('…') 之后，代码里还剩没剩中文 —— 剩下的就是没包 t() 的界面文字
 *   3. 同一个 key 在两个词典文件里译法不同
 *
 *   node scripts/i18n-check.mjs              # 汇总
 *   node scripts/i18n-check.mjs <路径片段>    # 只看匹配的文件，逐行列出
 *
 * 有问题 exit 1。
 *
 * 第 2 条是启发式的：给 AI 看的文字（系统提示词、工具说明）本来就可以是中文，
 * 那些文件列在 AI_FACING 里，不查第 2 条。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const DICT_DIR = path.join(SRC, 'lib/i18n/en');
const filter = process.argv[2];

/** 这些文件里的中文是给模型看的，或者是存进库里的值，不是界面文字 */
const AI_FACING = [
  'src/lib/i18n/',
  'src/lib/agent-tools.ts',
  'src/lib/data-tools.ts',
  'src/lib/page-tools.ts',
  'src/lib/chat-context.ts',
  'src/lib/sample-pages.data.ts',
  'src/lib/schema-upgrade.ts',
  'src/lib/env-guard.ts',
  'src/instrumentation.ts',
];

/**
 * 这些文件里放的是「中文原文当 key」的常量表（状态名、分类、导航标签），
 * 显示时由别处过 t()。这里的中文字符串不算漏翻，但**必须在英文词典里有**。
 */
const KEY_FILES = ['src/lib/format.ts', 'src/components/nav-tabs.tsx'];

/** 故意不翻的原文片段（比如设置页那个双语标题） */
const ALLOW = ['界面语言 · Language'];

const HAN = /[一-鿿]/;

// ---------- 读词典 ----------
async function loadDict(file) {
  const src = readFileSync(file, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace(/:\s*Dict\s*=/g, ' =');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  return Object.values(mod)[0];
}
const dicts = {};
for (const f of readdirSync(DICT_DIR)) {
  if (f === 'index.ts') continue;
  dicts[f] = await loadDict(path.join(DICT_DIR, f));
}
const EN = {};
const conflicts = [];
for (const [f, d] of Object.entries(dicts)) {
  for (const [k, v] of Object.entries(d)) {
    if (k in EN && EN[k].v !== v) conflicts.push(`「${k}」 ${EN[k].f}: ${EN[k].v}  vs  ${f}: ${v}`);
    EN[k] = { v, f };
  }
}

// ---------- 扫代码 ----------
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const full = path.join(dir, n);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs|js)$/.test(n)) out.push(full);
  }
  return out;
}

/**
 * 把注释替换成空格（保留换行，行号不变），字符串原样留着。
 * 正则字面量不认 —— 碰上带引号的正则可能错位，出了误报再说。
 */
function stripComments(s) {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') {
      while (i < s.length && s[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { out += s[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < s.length && s[i] !== c) {
        if (s[i] === '\\') { out += s[i] + (s[i + 1] ?? ''); i += 2; continue; }
        if (c !== '`' && s[i] === '\n') break;
        out += s[i]; i++;
      }
      out += s[i] ?? ''; i++;
    } else { out += c; i++; }
  }
  return out;
}

const T_CALL = /\bt\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');

const missing = new Map(); // key → [file:line]
const used = new Set();
const leftovers = []; // { file, line, text }

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replaceAll('\\', '/');
  const code = stripComments(readFileSync(file, 'utf8'));
  const lineOf = (idx) => code.slice(0, idx).split('\n').length;

  for (const m of code.matchAll(T_CALL)) {
    const key = unescape(m[2]);
    if (m[1] === '`' && key.includes('${')) {
      leftovers.push({ file: rel, line: lineOf(m.index), text: 't(`…${}…`) 不能带插值，用 t(\'…{n}…\', { n })' });
      continue;
    }
    used.add(key);
    if (HAN.test(key) && !(key in EN)) {
      if (!missing.has(key)) missing.set(key, []);
      missing.get(key).push(`${rel}:${lineOf(m.index)}`);
    }
  }

  if (AI_FACING.some((p) => rel.startsWith(p))) continue;
  if (KEY_FILES.includes(rel)) {
    for (const m of code.matchAll(/(['"])((?:\\.|(?!\1).)*?)\1/g)) {
      const key = unescape(m[2]);
      if (!HAN.test(key)) continue;
      used.add(key);
      if (!(key in EN)) {
        if (!missing.has(key)) missing.set(key, []);
        missing.get(key).push(`${rel}:${lineOf(m.index)}`);
      }
    }
    continue;
  }
  let rest = code.replace(T_CALL, (m) => m.replace(/[^\n]/g, ' '));
  for (const a of ALLOW) rest = rest.replaceAll(a, ' '.repeat(a.length));
  rest.split('\n').forEach((l, i) => {
    if (HAN.test(l)) leftovers.push({ file: rel, line: i + 1, text: l.trim().slice(0, 100) });
  });
}

// ---------- 报告 ----------
const pick = (arr, f) => (filter ? arr.filter((x) => f(x).includes(filter)) : arr);
let bad = false;

const miss = pick([...missing.entries()], ([, locs]) => locs.join(' '));
if (miss.length) {
  bad = true;
  console.log(`\n== 英文词典里没有的 key：${miss.length} 个 ==`);
  for (const [k, locs] of miss) console.log(`  「${k}」  ${locs.slice(0, 3).join(', ')}${locs.length > 3 ? ' …' : ''}`);
}

const left = pick(leftovers, (x) => x.file);
if (left.length) {
  bad = true;
  const byFile = {};
  for (const x of left) (byFile[x.file] ??= []).push(x);
  console.log(`\n== 没包 t() 的中文：${left.length} 行 ==`);
  for (const [f, xs] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${xs.length.toString().padStart(4)}  ${f}`);
    if (filter) for (const x of xs) console.log(`        ${x.line}: ${x.text}`);
  }
}

if (conflicts.length) {
  bad = true;
  console.log(`\n== 同一个 key 译法不同（统一到 common.ts）：${conflicts.length} ==`);
  conflicts.forEach((c) => console.log('  ' + c));
}

if (!filter) {
  const unused = Object.keys(EN).filter((k) => !used.has(k));
  if (unused.length) console.log(`\n（词典里有 ${unused.length} 个 key 代码里没用到 —— 不算错，可能是动态拼出来的：${unused.slice(0, 8).join('、')}${unused.length > 8 ? ' …' : ''}）`);
}

console.log(bad ? '\n✗ 有问题' : '\n✓ 干净');
process.exit(bad ? 1 : 0);
