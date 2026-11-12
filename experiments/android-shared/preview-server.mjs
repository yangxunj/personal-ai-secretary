// Optional desktop layout preview only. Browser mocks do not validate Android SQLite.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { topicPlugins } from '../../src/topic-plugins/registry.mjs';
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/pilot.js', ['pilot.js', 'text/javascript; charset=utf-8']],
  ['/pilot.css', ['pilot.css', 'text/css; charset=utf-8']],
  ['/messages.js', ['messages.js', 'text/javascript; charset=utf-8']],
  ['/shared-message.css', ['shared-message.css', 'text/css; charset=utf-8']],
  ['/surface-theme.css', ['surface-theme.css', 'text/css; charset=utf-8']],
  ['/assets/marp-theme.css', ['marp-theme.css', 'text/css; charset=utf-8']],
  ['/assets/slide-view.css', ['slide-view.css', 'text/css; charset=utf-8']],
]);
for (const plugin of topicPlugins) files.set(`/topic-plugin-${plugin.id}.css`, [`topic-plugin-${plugin.id}.css`, 'text/css; charset=utf-8']);
const server = http.createServer(async (request, response) => {
  const item = files.get(new URL(request.url, 'http://localhost').pathname);
  if (!item) { response.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(new URL(`web-dist/${item[0]}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': item[1], 'Cache-Control': 'no-store' }).end(bytes);
  } catch { response.writeHead(503).end('Run build-web.mjs first.'); }
});
server.listen(8465, '127.0.0.1', () => console.log('Pilot browser preview http://127.0.0.1:8465 (not Android acceptance)'));
