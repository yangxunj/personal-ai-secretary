// Read tracked source only. This inventories direct imports, not compatibility.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = execFileSync('git', ['ls-files', '-z', '--', 'src', 'desktop'], {
  cwd: root, encoding: 'utf8', windowsHide: true,
}).split('\0').filter(file => /\.(?:[cm]?js|tsx?)$/.test(file) && !/\.d\.[cm]?ts$/.test(file));
const groups = { next: [], electron: [], node: [], prisma: [], native: [], pi: [] };
const native = new Set(['sharp', '@napi-rs/canvas', 'unpdf']);
for (const file of files.sort()) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, new URL('../../', import.meta.url)), 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = new Set();
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes = clause?.isTypeOnly || node.isTypeOnly ||
        (clause && !clause.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly));
      if (!onlyTypes && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const [name, matches] of Object.entries(groups)) {
    const dependencies = [...imports].filter(value =>
      name === 'next' ? value === 'next' || value.startsWith('next/') :
      name === 'electron' ? value === 'electron' :
      name === 'node' ? value.startsWith('node:') :
      name === 'prisma' ? value.startsWith('@prisma/') :
      name === 'native' ? native.has(value) : value.startsWith('@earendil-works/'));
    if (dependencies.length) matches.push({ file, dependencies: dependencies.sort() });
  }
}
console.log(JSON.stringify({
  scope: 'Tracked src/ and desktop/ direct runtime imports; excludes type-only imports.',
  limitations: 'No transitive analysis, globals, computed imports, package binaries or device compatibility checks. Empty findings do not prove portability.',
  scannedFiles: files.length,
  counts: Object.fromEntries(Object.entries(groups).map(([name, matches]) => [name, matches.length])),
  groups,
}, null, 2));
