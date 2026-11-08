import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSharedCore, sharedUiEntries } from '../../scripts/check-shared-core.mjs';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { bundleLicenses } from './bundle-licenses.mjs';
import { topicPlugins } from '../../src/topic-plugins/registry.mjs';

const require = createRequire(import.meta.url);
const compiled = require('next/dist/compiled/webpack/webpack');
compiled.init();
const webpack = compiled.webpack;
const directory = fileURLToPath(new URL('.', import.meta.url));
const root = path.resolve(directory, '../..');
const sharedBoundary = checkSharedCore(root);
const messageSource = 'src/components/MessageBody.tsx';
const sharedUiBoundary = checkSharedCore(root, sharedUiEntries, ['react', 'react/jsx-runtime', 'react-markdown', 'remark-gfm']);
const output = path.join(directory, 'web-dist');
const schema = 'src/lib/collections/schema.ts';
const service = 'src/lib/collections/record-write.ts';
const config = JSON.parse(await readFile(path.join(directory, 'pilot-config.json'), 'utf8'));
const piPackage = JSON.parse(await readFile(path.join(root, 'node_modules/@earendil-works/pi-agent-core/package.json'), 'utf8'));
if (piPackage.version !== '1.4.0') throw new Error('Revalidate the browser Pi adapter before upgrading pi-agent-core. Expected 1.4.0.');
await mkdir(output, { recursive: true });
let licenses;
await new Promise((resolve, reject) => webpack({
  mode: 'production', target: ['web', 'es2020'], context: root,
  entry: { pilot: path.join(directory, 'web/pilot.mjs'), messages: path.join(directory, 'web/message-ui.mjs') },
  output: { path: output, filename: '[name].js' },
  devtool: false,
  optimization: { minimize: false },
  resolve: { extensions: ['.tsx', '.ts', '.js', '.mjs', '.json'], alias: { '@earendil-works/pi-ai$': path.join(directory, 'pi-ai-browser.mjs'), '@': path.join(root, 'src') } },
  module: { rules: [{ test: /\.tsx?$/, use: path.join(directory, 'typescript-loader.cjs') }] },
  plugins: [{ apply(compiler) {
    compiler.hooks.normalModuleFactory.tap('SharedBoundary', factory => {
      factory.hooks.beforeResolve.tap('SharedBoundary', request => {
        if (request && /^(?:node:|next(?:\/|$)|electron$|@prisma\/)/.test(request.request)) {
          throw new Error(`Platform dependency entered shared browser bundle: ${request.request}`);
        }
      });
    });
  } }],
}, async (error, stats) => {
  if (error || stats.hasErrors()) return reject(error || new Error(stats.toString({ all: false, errors: true })));
  console.log(stats.toString({ all: false, assets: true, errors: true, warnings: true }));
  try { licenses = await bundleLicenses(stats.compilation.modules, directory); }
  catch (error) { reject(error); return; }
  resolve();
}));
const pluginStyles = [];
for (const plugin of topicPlugins) {
  if (plugin.styleFile !== `src/topic-plugins/${plugin.id}/styles.css`) throw new Error(`Invalid plugin style path: ${plugin.id}`);
  const name = `topic-plugin-${plugin.id}.css`;
  await copyFile(path.join(root, plugin.styleFile), path.join(output, name));
  pluginStyles.push(name);
}
await writeFile(path.join(output, 'index.html'), (await readFile(path.join(directory, 'web/index.html'), 'utf8'))
  .replaceAll('__PILOT_VERSION__', config.version)
  .replace('<!-- TOPIC_PLUGIN_STYLES -->', pluginStyles.map(name => `<link rel="stylesheet" href="${name}">`).join('\n  ')));
await copyFile(path.join(directory, 'web/pilot.css'), path.join(output, 'pilot.css'));
await copyFile(path.join(root, 'src/styles/surface-theme.css'), path.join(output, 'surface-theme.css'));
const stylesSource = path.join(directory, 'web/shared-message.css');
const styles = await postcss([tailwindcss({ base: root, optimize: false })]).process(await readFile(stylesSource, 'utf8'), { from: stylesSource, to: path.join(output, 'shared-message.css'), map: false });
await writeFile(path.join(output, 'shared-message.css'), styles.css);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = {
  bundledPackages: licenses.packages,
  sharedBoundary,
  sharedUiBoundary,
  sharedUiSources: await Promise.all(sharedUiBoundary.files.map(async file => ({ file, sha256: hash(await readFile(path.join(root, file))) }))),
  messageSource, messageSourceSha256: hash(await readFile(path.join(root, messageSource))),
  messageBundleSha256: hash(await readFile(path.join(output, 'messages.js'))),
  messageStylesSha256: hash(await readFile(path.join(output, 'shared-message.css'))),
  surfaceThemeSha256: hash(await readFile(path.join(root, 'src/styles/surface-theme.css'))),
  pilot: config.version, sharedSource: schema,
  sharedSourceSha256: hash(await readFile(path.join(root, schema))),
  sharedService: service, sharedServiceSha256: hash(await readFile(path.join(root, service))),
  sharedToolContractsSha256: hash(await readFile(path.join(root, 'src/lib/collections/tool-contracts.ts'))),
  taskContractsSha256: hash(await readFile(path.join(root, 'src/lib/tasks/contracts.ts'))),
  taskServiceSha256: hash(await readFile(path.join(root, 'src/lib/tasks/service.ts'))),
  taskListViewSha256: hash(await readFile(path.join(root, 'src/lib/tasks/list-view.ts'))),
  ownersPolicySha256: hash(await readFile(path.join(root, 'src/lib/tasks/owners-policy.ts'))),
  topicPlugins: await Promise.all(topicPlugins.map(async ({ id, path: route, capabilities, sourceFiles }) => ({ id, path: route, capabilities,
    sources: await Promise.all(sourceFiles.map(async name => {
      if (!/^(?:[a-z0-9-]+\.(?:mjs|css)|PLUGIN\.md|android\/[A-Za-z0-9]+\.java)$/.test(name)) throw new Error(`Invalid plugin source: ${id}`);
      return { name, sha256: hash(await readFile(path.join(root, 'src/topic-plugins', id, name))) };
    })) }))),
  taskPolicySha256: hash(await readFile(path.join(root, 'src/lib/tasks/policy.ts'))),
  conversationSha256: hash(await readFile(path.join(root, 'src/lib/pi/conversation.mjs'))),
  contextBudgetSha256: hash(await readFile(path.join(root, 'src/lib/pi/context-budget.mjs'))),
  webSearchSharedSha256: hash(await readFile(path.join(root, 'src/lib/web-search/shared.mjs'))),
  webSearchUrlSha256: hash(await readFile(path.join(root, 'src/lib/web-search/url.mjs'))),
  citationSha256: hash(await readFile(path.join(root, 'src/lib/agent-citations.mjs'))),
  piAgentCoreVersion: piPackage.version,
  piAgentLoopSha256: hash(await readFile(path.join(root, 'node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js'))),
  bundleSha256: hash(await readFile(path.join(output, 'pilot.js'))),
  scope: 'Production MessageBody React component and generated utilities; shared policies/Pi snapshots; fixed DeepSeek, no automatic compaction.',
};
await writeFile(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const assets = path.join(directory, 'android/app/src/main/assets');
await mkdir(assets, { recursive: true });
await writeFile(path.join(assets, 'bundled-js-licenses.txt'), licenses.text);
for (const file of ['index.html', 'pilot.css', 'pilot.js', 'messages.js', 'shared-message.css', 'surface-theme.css', 'build-manifest.json', ...pluginStyles]) await copyFile(path.join(output, file), path.join(assets, file));
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
  'React, React DOM, react-markdown, remark-gfm and bundled transitive JavaScript dependencies: see bundled-js-licenses.txt.',
  'Tailwind CSS utility output: MIT; generated from the existing shared MessageBody source.',
  'AndroidX WebKit, Annotation, Core and related AndroidX runtime code: Apache-2.0; see apache-2.0.txt.',
  'The Android system WebView is provided by the device, not bundled here.',
].join('\n') + '\n');
console.log(`Bundled shared source ${schema} (${manifest.sharedSourceSha256})`);
