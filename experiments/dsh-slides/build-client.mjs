import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marp } from '@marp-team/marp-core';
import { bundleLicenses } from '../android-shared/bundle-licenses.mjs';

const require = createRequire(import.meta.url), compiled = require('next/dist/compiled/webpack/webpack');
compiled.init(); const webpack = compiled.webpack;
const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const output = path.join(root, 'experiments/android-shared/artifacts/dsh-secretary-build');
await mkdir(output, { recursive: true });
const theme = new Marp({ html:false, inlineSVG:false }).render('# Preview').css;
const adaptive = await readFile(path.join(root, 'experiments/android-shared/web/slide-view.css'), 'utf8');
let notices;
await new Promise((resolve, reject) => webpack({
  mode:'production', target:['web', 'es2020'], context:root, entry:path.join(directory, 'web-src/client.tsx'),
  output:{ path:output, filename:'client.cjs', library:{ type:'commonjs2' } },
  devtool:false, optimization:{ minimize:false },
  resolve:{ extensions:['.tsx','.ts','.js','.mjs','.json'] },
  externals:{ react:'commonjs react', 'react/jsx-runtime':'commonjs react/jsx-runtime' },
  module:{ rules:[{ test:/\.tsx?$/, use:path.join(root,'experiments/android-shared/typescript-loader.cjs') }] },
  plugins:[new webpack.DefinePlugin({ __SLIDE_STYLES__: JSON.stringify({ theme, adaptive }) })],
}, async (error, stats) => {
  if (error || stats.hasErrors()) return reject(error || new Error(stats.toString({ all:false, errors:true })));
  const moduleNames = [...stats.compilation.modules].map(module => module.resource || '');
  for (const required of ['SideNavView.tsx', 'SlideViewer.tsx']) {
    if (!moduleNames.some(name => name.endsWith(required))) return reject(new Error(`共享组件未进入构建: ${required}`));
  }
  try { notices = await bundleLicenses(stats.compilation.modules, path.join(root, 'experiments/android-shared')); }
  catch (e) { return reject(e); }
  console.log(stats.toString({ all:false, assets:true, warnings:true })); resolve();
}));
const uncompressed = await readFile(path.join(output, 'client.cjs'), 'utf8');
const { minify } = require('next/dist/compiled/terser');
const { code } = await minify(uncompressed, { compress: true, mangle: true, format: { comments: false } });
if (!code) throw new Error('客户端压缩失败');
await writeFile(path.join(directory, 'lib/client.js'), `window.__ModuleLoader__.load({id:'dsh-secretary-slides-pilot',factory(require){const module={exports:{}};const exports=module.exports;\n${code}\nreturn module.exports;}});\n`);
await writeFile(path.join(directory, 'lib/bundled-licenses.txt'), notices.text);
