import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const sharedEntries = [
  'src/lib/collections/schema.ts',
  'src/lib/collections/record-write.ts',
  'src/lib/collections/tool-contracts.ts',
  'src/lib/tasks/contracts.ts',
  'src/lib/tasks/policy.ts',
  'src/lib/tasks/service.ts',
  'src/lib/tasks/list-view.ts',
  'src/lib/pi/conversation.mjs',
  'src/lib/pi/context-budget.mjs',
];
export const sharedUiEntries = [
  'src/components/MessageBody.tsx',
  'src/components/chat/shared/ConversationListView.tsx',
  'src/components/chat/shared/ChatTextInput.tsx',
  'src/components/tasks/shared/TaskCard.tsx',
];
const repository = fileURLToPath(new URL('../', import.meta.url));

/** Check the runtime closure of shared source. Type-only imports are erased by
 * TypeScript. Third-party code is not audited here; only reviewed package entry
 * points are allowed. This is a dependency check, not proof of device support. */
export function checkSharedCore(root = repository, entries = sharedEntries, allowedPackages = ['zod']) {
  const sourceRoot = realpathSync(path.join(root, 'src'));
  const visited = new Set();
  const external = new Set();
  function resolveLocal(from, specifier) {
    const base = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
    const candidate = [base, ...['.tsx', '.ts', '.mjs', '.js', '/index.tsx', '/index.ts', '/index.mjs', '/index.js'].map(suffix => base + suffix)]
      .find(file => existsSync(file) && statSync(file).isFile());
    if (!candidate) throw new Error(`Unresolved shared import: ${specifier} in ${path.relative(root, from)}`);
    const resolved = realpathSync(candidate);
    const relative = path.relative(sourceRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Shared import leaves src: ${specifier}`);
    return resolved;
  }
  function visit(file) {
    file = realpathSync(file);
    if (visited.has(file)) return;
    visited.add(file);
    const original = readFileSync(file, 'utf8');
    const output = ts.transpileModule(original, { fileName: file, compilerOptions: {
      target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const parsed = ts.createSourceFile(file + '.js', output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function dependency(expression) {
      if (!expression || !ts.isStringLiteralLike(expression)) throw new Error(`Computed import is forbidden in shared source: ${path.relative(root, file)}`);
      const specifier = expression.text;
      if (allowedPackages.includes(specifier)) { external.add(specifier); return; }
      if (specifier.startsWith('.') || specifier.startsWith('@/')) visit(resolveLocal(file, specifier));
      else throw new Error(`Platform or unreviewed dependency in shared source: ${specifier} in ${path.relative(root, file)}`);
    }
    function walk(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier) dependency(node.moduleSpecifier);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) dependency(node.arguments[0]);
      ts.forEachChild(node, walk);
    }
    walk(parsed);
  }
  for (const entry of entries) visit(path.resolve(root, entry));
  return { files: [...visited].map(file => path.relative(root, file).replaceAll('\\', '/')).sort(), packages: [...external].sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(checkSharedCore(), null, 2));
}
