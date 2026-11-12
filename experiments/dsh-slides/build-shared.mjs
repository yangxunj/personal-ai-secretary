import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../../src/lib/slides/contracts.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
await writeFile(new URL('./lib/contracts.js', import.meta.url), '// Generated from src/lib/slides/contracts.ts; run build-shared.mjs after changing it.\n' + output);
