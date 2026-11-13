// Builds an isolated proof of concept, never modifies the installed DSH.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const output = path.join(root, `experiments/android-shared/artifacts/${process.argv.includes('--desktop') ? 'dsh-sidebar-desktop-custom-rc2' : 'dsh-sidebar-custom-rc2'}`);
const asarPath = process.argv[2];
if (!asarPath) throw new Error('用法: node build-isolated.mjs <DSH app.asar 路径>');
const asar = await readFile(asarPath);
const header = JSON.parse(asar.subarray(16, 16 + asar.readUInt32LE(12)).toString());
const base = 8 + asar.readUInt32LE(4);
let folder = header;
for (const part of 'dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar'.split('/')) folder = folder.files?.[part];
if (!folder?.files) throw new Error('找不到 DSH 侧栏包');
const files = new Map();
function collect(entry, name = '') {
  for (const [key, value] of Object.entries(entry.files || {})) {
    const file = name ? `${name}/${key}` : key;
    if (file === 'src') continue;
    if (value.files) collect(value, file);
    else if (!value.unpacked && value.offset !== undefined) files.set(file, asar.subarray(base + Number(value.offset), base + Number(value.offset) + value.size));
  }
}
collect(folder);
const original = files.get('lib/client.js');
if (!original || createHash('sha256').update(original).digest('hex') !== '3e2327e5f6773a35c7b06a8403d49fc944c0afe5493a8b464e2c4c7897800a66') throw new Error('DSH 侧栏版本不匹配，停止构建');
const pkg = JSON.parse(files.get('package.json').toString());
if (pkg.version !== '0.2.2-rc.2') throw new Error('DSH 版本不匹配');
if (process.argv.includes('--verify-only')) {
  console.log('DSH 侧栏版本校验通过');
  process.exit(0);
}

const require = createRequire(import.meta.url), compiled = require('next/dist/compiled/webpack/webpack');
compiled.init();
await mkdir(output, { recursive: true });
await new Promise((resolve, reject) => compiled.webpack({
  mode:'production', target:['web','es2020'], context:root, entry:path.join(here,'secretary-nav.tsx'),
  output:{path:output,filename:'secretary-nav.cjs',library:{type:'commonjs2'}}, devtool:false,
  optimization:{minimize:false}, resolve:{extensions:['.tsx','.ts','.js','.mjs','.json']},
  externals:{react:'commonjs react','react/jsx-runtime':'commonjs react/jsx-runtime'},
  module:{rules:[{test:/\.tsx?$/,use:path.join(root,'experiments/android-shared/typescript-loader.cjs')}]},
}, (error, stats) => {
  if (error || stats.hasErrors()) return reject(error || new Error(stats.toString({all:false,errors:true})));
  if (![...stats.compilation.modules].some(module => module.resource?.endsWith('SideNavView.tsx'))) return reject(new Error('未编入共享导航组件'));
  resolve();
}));
const compiledNav = await readFile(path.join(output,'secretary-nav.cjs'),'utf8');
const { code } = await require('next/dist/compiled/terser').minify(compiledNav, {compress:true,mangle:true});
if (!code) throw new Error('导航编译失败');
let client = original.toString();
const insertion = 'function SidebarRoot(';
const target = 'children:renderSlot(`sidebar.workspaces`,{wide,expandSidebar:()=>{if(collapsed)toggleSidebar()}},{hookContext:sectionHookContext})';
const panelFilter = 'panels.filter(({id})=>id===`plugins`||!hasEntryActions||!unpinned.includes(id))';
if ([insertion, target, panelFilter].some(value => client.split(value).length !== 2)) throw new Error('侧栏结构已变更，停止构建');
client = client.replace(insertion, `const SecretaryContainer=(()=>{const module={exports:{}};const exports=module.exports;${code};return module.exports.default})();${insertion}`);
client = client.replace(target, 'children:(0,react_jsx_runtime.jsx)(SecretaryContainer,{wide,activePanelId,panels,selectPanel,children:renderSlot(`sidebar.workspaces`,{wide,expandSidebar:()=>{if(collapsed)toggleSidebar()}},{hookContext:sectionHookContext})})');
client = client.replace(panelFilter, 'panels.filter(({id})=>(!wide||![`secretary-slides-pilot`,`secretary-shell-pilot`].includes(id))&&(id===`plugins`||!hasEntryActions||!unpinned.includes(id)))');
files.set('lib/client.js', Buffer.from(client));
for (const [name, contents] of files) {
  const file = path.join(output, name);
  await mkdir(path.dirname(file), {recursive:true});
  await writeFile(file, contents);
}
await writeFile(path.join(output, '.secretary-build.json'), JSON.stringify({
  version: pkg.version,
  clientSha256: createHash('sha256').update(client).digest('hex'),
}) + '\n');
console.log(`隔离侧栏包已生成: ${output}`);
