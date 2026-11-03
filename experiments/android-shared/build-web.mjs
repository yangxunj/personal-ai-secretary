import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const compiled = require('next/dist/compiled/webpack/webpack');
compiled.init();
const webpack = compiled.webpack;
const directory = fileURLToPath(new URL('.', import.meta.url));
const root = path.resolve(directory, '../..');
const output = path.join(directory, 'web-dist');
const schema = 'src/lib/collections/schema.ts';
await mkdir(output, { recursive: true });
await new Promise((resolve, reject) => webpack({
  mode: 'production', target: ['web', 'es2020'], context: root,
  entry: path.join(directory, 'web/pilot.mjs'),
  output: { path: output, filename: 'pilot.js' },
  devtool: false,
  optimization: { minimize: false },
  module: { rules: [{ test: /\.ts$/, use: path.join(directory, 'typescript-loader.cjs') }] },
  plugins: [{ apply(compiler) {
    compiler.hooks.normalModuleFactory.tap('SharedBoundary', factory => {
      factory.hooks.beforeResolve.tap('SharedBoundary', request => {
        if (request && /^(?:node:|next(?:\/|$)|electron$|@prisma\/)/.test(request.request)) {
          throw new Error(`Platform dependency entered shared browser bundle: ${request.request}`);
        }
      });
    });
  } }],
}, (error, stats) => {
  if (error || stats.hasErrors()) return reject(error || new Error(stats.toString({ all: false, errors: true })));
  console.log(stats.toString({ all: false, assets: true, errors: true, warnings: true }));
  resolve();
}));
for (const file of ['index.html', 'pilot.css']) await copyFile(path.join(directory, 'web', file), path.join(output, file));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = {
  pilot: '0.1.0', sharedSource: schema,
  sharedSourceSha256: hash(await readFile(path.join(root, schema))),
  bundleSha256: hash(await readFile(path.join(output, 'pilot.js'))),
  scope: 'Local collection validation and SQLite persistence only; no AI or remote backend.',
};
await writeFile(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const assets = path.join(directory, 'android/app/src/main/assets');
await mkdir(assets, { recursive: true });
for (const file of ['index.html', 'pilot.css', 'pilot.js', 'build-manifest.json']) await copyFile(path.join(output, file), path.join(assets, file));
// Preserve notices for code shipped inside the APK (build tools are not shipped).
await copyFile(path.join(root, 'node_modules/zod/LICENSE'), path.join(assets, 'zod-license.txt'));
await copyFile(path.join(root, 'node_modules/typescript/LICENSE.txt'), path.join(assets, 'apache-2.0.txt'));
await copyFile(path.join(root, 'LICENSE'), path.join(assets, 'project-license.txt'));
await writeFile(path.join(assets, 'third-party-notices.txt'), [
  'Secretary Shared Pilot: AGPL-3.0-or-later; see project-license.txt.',
  'Corresponding source: https://github.com/yangxunj/personal-ai-secretary/tree/main/experiments/android-shared',
  'Zod: MIT, Copyright (c) 2025 Colin McDonnell; see zod-license.txt.',
  'AndroidX WebKit, Annotation, Core and related AndroidX runtime code: Apache-2.0; see apache-2.0.txt.',
  'The Android system WebView is provided by the device, not bundled here.',
].join('\n') + '\n');
console.log(`Bundled shared source ${schema} (${manifest.sharedSourceSha256})`);
