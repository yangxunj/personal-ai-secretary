import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { assertManagedPptTarget, sendPptRuntimeConfig } from '../src/lib/ppt-runtime-transport.mjs';

const token = 'a'.repeat(64);
const config = { textBaseUrl: 'https://example.invalid/v1', textModel: 'test', textKey: 'test-text-key', imageKey: 'test-image-key' };

test('rejects the existing service before any configuration is sent', () => {
  assert.throws(() => assertManagedPptTarget('http://127.0.0.1:5012', '15398'), /原有独立实例/);
  assert.doesNotThrow(() => assertManagedPptTarget('http://127.0.0.1:15398', '15398'));
});

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
async function close(server) { await new Promise(resolve => server.close(resolve)); }

test('does not send provider keys to an engine that cannot prove its identity', async () => {
  let writes = 0;
  const { server, base } = await serve((req, res) => {
    if (req.method === 'POST') writes++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ version: 1, proof: '0'.repeat(64) }));
  });
  try {
    await assert.rejects(sendPptRuntimeConfig(base, token, config), /无法确认项目内引擎身份/);
    assert.equal(writes, 0);
  } finally { await close(server); }
});

test('sends config only after valid proof and reports a busy engine without leaking keys', async () => {
  let seen = false;
  const { server, base } = await serve((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') {
      const proof = createHmac('sha256', token).update(req.headers['x-secretary-nonce']).digest('hex');
      res.end(JSON.stringify({ version: 1, proof }));
    } else {
      seen = req.headers['x-secretary-control'] === token;
      req.resume();
      res.statusCode = 409;
      res.end(JSON.stringify({ error: 'busy' }));
    }
  });
  try {
    await assert.rejects(sendPptRuntimeConfig(base, token, config), e => /正在处理其他任务/.test(e.message) && !e.message.includes(config.imageKey));
    assert.equal(seen, true);
  } finally { await close(server); }
});
