import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { validClient } = createRequire(import.meta.url)('../gmail.js');

// Native OAuth client configuration is distributable app identity, not a user's
// grant. Never copy the input directory or any access/refresh tokens into a build.
export function prepareBundledGmail(source, output) {
  if (!source) { rmSync(output, { force: true }); return false; }
  let client;
  try {
    const bytes = readFileSync(source);
    if (bytes.length > 65536) throw new Error();
    client = validClient(JSON.parse(bytes.toString('utf8')));
  } catch { throw new Error('Invalid Google Desktop OAuth configuration; build stopped.'); }
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ version: 1, testing: true, client }), { mode: 0o600 });
  return true;
}
