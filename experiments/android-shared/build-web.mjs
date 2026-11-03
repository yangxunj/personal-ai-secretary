import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSharedCore } from '../../scripts/check-shared-core.mjs';

const require = createRequire(import.meta.url);
const compiled = require('next/dist/compiled/webpack/webpack');
compiled.init();
const webpack = compiled.webpack;
const directory = fileURLToPath(new URL('.', import.meta.url));
const root = path.resolve(directory, '../..');
const sharedBoundary = checkSharedCore(root);
const output = path.join(directory, 'web-dist');
const schema = 'src/lib/collections/schema.ts';
const service = 'src/lib/collections/record-write.ts';
const config = JSON.parse(await readFile(path.join(directory, 'pilot-config.json'), 'utf8'));
const piPackage = JSON.parse(await readFile(path.join(root, 'node_modules/@earendil-works/pi-agent-core/package.json'), 'utf8'));
if (piPackage.version !== '1.4.0') throw new Error('Revalidate the browser Pi adapter before upgrading pi-agent-core. Expected 1.4.0.');
await mkdir(output, { recursive: true });
await new Promise((resolve, reject) => webpack({
  mode: 'production', target: ['web', 'es2020'], context: root,
  entry: path.join(directory, 'web/pilot.mjs'),
  output: { path: output, filename: 'pilot.js' },
  devtool: false,
  optimization: { minimize: false },
  resolve: { extensions: ['.ts', '.js', '.mjs', '.json'], alias: { '@earendil-works/pi-ai$': path.join(directory, 'pi-ai-browser.mjs') } },
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
await writeFile(path.join(output, 'index.html'), (await readFile(path.join(directory, 'web/index.html'), 'utf8')).replaceAll('__PILOT_VERSION__', config.version));
await copyFile(path.join(directory, 'web/pilot.css'), path.join(output, 'pilot.css'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = {
  sharedBoundary,
  pilot: config.version, sharedSource: schema,
  sharedSourceSha256: hash(await readFile(path.join(root, schema))),
  sharedService: service, sharedServiceSha256: hash(await readFile(path.join(root, service))),
  sharedToolContractsSha256: hash(await readFile(path.join(root, 'src/lib/collections/tool-contracts.ts'))),
  taskContractsSha256: hash(await readFile(path.join(root, 'src/lib/tasks/contracts.ts'))),
  taskPolicySha256: hash(await readFile(path.join(root, 'src/lib/tasks/policy.ts'))),
  piAgentCoreVersion: piPackage.version,
  piAgentLoopSha256: hash(await readFile(path.join(root, 'node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js'))),
  bundleSha256: hash(await readFile(path.join(output, 'pilot.js'))),
  scope: 'Shared formal task and collection tools, upstream Pi, durable tool receipts; task UI + fixed-host DeepSeek; single turn, no session compaction.',
};
await writeFile(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const assets = path.join(directory, 'android/app/src/main/assets');
await mkdir(assets, { recursive: true });
for (const file of ['index.html', 'pilot.css', 'pilot.js', 'build-manifest.json']) await copyFile(path.join(output, file), path.join(assets, file));
// Preserve notices for code shipped inside the APK (build tools are not shipped).
await copyFile(path.join(root, 'node_modules/zod/LICENSE'), path.join(assets, 'zod-license.txt'));
await copyFile(path.join(root, 'node_modules/typescript/LICENSE.txt'), path.join(assets, 'apache-2.0.txt'));
await copyFile(path.join(root, 'LICENSE'), path.join(assets, 'project-license.txt'));
await copyFile(path.join(directory, 'licenses/pi-MIT.txt'), path.join(assets, 'pi-license.txt'));
await copyFile(path.join(root, 'node_modules/typebox/license'), path.join(assets, 'typebox-license.txt'));
await writeFile(path.join(assets, 'third-party-notices.txt'), [
  'Secretary Shared Pilot: AGPL-3.0-or-later; see project-license.txt.',
  'Corresponding source: https://github.com/yangxunj/personal-ai-secretary/tree/main/experiments/android-shared',
  'Zod: MIT, Copyright (c) 2025 Colin McDonnell; see zod-license.txt.',
  'Pi agent-core / pi-ai 1.4.0: MIT, Copyright (c) 2025 Mario Zechner; see pi-license.txt.',
  'TypeBox: MIT, Copyright (c) 2017-2026 Haydn Paterson; see typebox-license.txt.',
  'AndroidX WebKit, Annotation, Core and related AndroidX runtime code: Apache-2.0; see apache-2.0.txt.',
  'The Android system WebView is provided by the device, not bundled here.',
].join('\n') + '\n');
console.log(`Bundled shared source ${schema} (${manifest.sharedSourceSha256})`);
