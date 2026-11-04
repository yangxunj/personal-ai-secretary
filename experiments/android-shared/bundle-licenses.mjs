import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

// Use actual webpack module resources, including concatenated modules. Never
// walk the whole node_modules tree or copy packages into the APK.
export async function bundleLicenses(modules, pilotRoot) {
  const roots = new Set();
  async function visit(module) {
    if (module.resource?.includes('node_modules')) {
      let directory = path.dirname(module.resource.split('?')[0]);
      while (directory.includes('node_modules')) {
        try {
          const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
          if (pkg.name && pkg.version) { roots.add(directory); break; }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        directory = path.dirname(directory);
      }
    }
    for (const nested of module.modules || []) await visit(nested);
  }
  for (const module of modules) await visit(module);
  // The generated utility stylesheet also ships in the APK.
  roots.add(path.resolve(pilotRoot, '../../node_modules/tailwindcss'));
  const notices = [], packages = [];
  for (const directory of roots) {
    const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const names = (await readdir(directory)).filter(name => /^licen[cs]e(?:[.-]|$)/i.test(name));
    const texts = [];
    for (const name of names.sort()) if ((await stat(path.join(directory, name))).isFile()) texts.push(await readFile(path.join(directory, name), 'utf8'));
    if (!texts.length && pkg.name.startsWith('@earendil-works/') && pkg.license === 'MIT') texts.push(await readFile(path.join(pilotRoot, 'licenses/pi-MIT.txt'), 'utf8'));
    if (!texts.length) throw new Error(`Review missing bundled license: ${pkg.name}@${pkg.version}`);
    packages.push({ name: pkg.name, version: pkg.version, license: pkg.license });
    notices.push(`${pkg.name}@${pkg.version} (${pkg.license})\n${texts.join('\n')}`);
  }
  packages.sort((a, b) => a.name.localeCompare(b.name)); notices.sort();
  return { packages, text: notices.join('\n\n============================================================\n\n') + '\n' };
}
