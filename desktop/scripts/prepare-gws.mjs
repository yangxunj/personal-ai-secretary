import { existsSync, readFileSync, mkdirSync, copyFileSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const GWS_VERSION = '0.22.5';
export const GWS_ARCHIVE_SHA256 = '407705d695dc83d48b1c5f50d71b5aa64095bf6f17d5b439b2e9a373bbe67ec2';
export const GWS_BINARY_SHA256 = '82ad48dd28564be969174aaef3e3f99816f959bf2519eeeb4ab77d84f9fa9c67';
const desktop = path.resolve(import.meta.dirname, '..');
const tools = path.join(desktop, 'tools'), output = path.join(tools, `gws-${GWS_VERSION}`);
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export async function prepareGws() {
  if (existsSync(path.join(output, 'gws.exe')) && digest(path.join(output, 'gws.exe')) === GWS_BINARY_SHA256 && existsSync(path.join(output, 'LICENSE'))) return;
  mkdirSync(tools, { recursive: true });
  const temp = mkdtempSync(path.join(tools, '.gws-download-'));
  try {
    const archive = path.join(temp, 'gws.zip');
    const response = await fetch(`https://github.com/googleworkspace/cli/releases/download/v${GWS_VERSION}/google-workspace-cli-x86_64-pc-windows-msvc.zip`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || Number(response.headers.get('content-length') || 0) > 80000000) throw new Error('GWS download failed');
    const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 80000000) throw new Error('GWS archive too large');
    writeFileSync(archive, bytes);
    if (digest(archive) !== GWS_ARCHIVE_SHA256) throw new Error('GWS archive checksum mismatch');
    const unpacked = path.join(temp, 'unpacked');
    const quote = text => "'" + text.replaceAll("'", "''") + "'";
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(unpacked)}`], { windowsHide: true, stdio: 'pipe' });
    const find = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? find(path.join(dir, d.name)) : [path.join(dir, d.name)]);
    const files = find(unpacked), executable = files.find(f => path.basename(f) === 'gws.exe'), license = files.find(f => path.basename(f) === 'LICENSE');
    if (!executable || !license || digest(executable) !== GWS_BINARY_SHA256) throw new Error('GWS payload invalid');
    mkdirSync(output, { recursive: true });
    copyFileSync(executable, path.join(output, 'gws.exe')); copyFileSync(license, path.join(output, 'LICENSE'));
    console.log(`Prepared GWS ${GWS_VERSION} (Windows x64, checksums verified)`);
  } finally {
    const relative = path.relative(tools, temp);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(temp).startsWith('.gws-download-')) throw new Error('Unsafe GWS cleanup path');
    rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await prepareGws();
