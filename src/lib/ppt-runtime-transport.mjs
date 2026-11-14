import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function assertManagedPptTarget(base, expectedPort) {
  if (new URL(base).port !== expectedPort) throw new Error('PPT 服务当前连接的是原有独立实例；请先启动并连接项目内引擎，原有实例的设置不会被更改。');
}

/** The provider secrets are never sent until the backend proves possession of the local control token. */
export async function sendPptRuntimeConfig(base, token, config) {
  const nonce = randomBytes(32).toString('hex');
  try {
    const probe = await fetch(base + '/api/secretary/capabilities', { headers: { 'X-Secretary-Nonce': nonce }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const body = await probe.json();
    const expected = createHmac('sha256', token).update(nonce).digest();
    const proof = typeof body.proof === 'string' && /^[a-f0-9]{64}$/.test(body.proof) ? Buffer.from(body.proof, 'hex') : Buffer.alloc(0);
    if (!probe.ok || body.version !== 1 || proof.length !== expected.length || !timingSafeEqual(proof, expected)) throw new Error('mismatch');
  } catch { throw new Error('PPT 服务无法确认项目内引擎身份，请检查服务和数据目录。'); }
  let response;
  try {
    response = await fetch(base + '/api/secretary/configure', {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', 'X-Secretary-Control': token },
      body: JSON.stringify(config),
    });
  } catch { throw new Error('PPT 服务配置暂时不可用，请检查引擎是否运行。'); }
  if (response.status === 409) throw new Error('PPT 服务正在处理其他任务，请等任务结束后再应用新配置。');
  if (!response.ok) throw new Error('PPT 服务未能应用模型配置，请检查引擎版本。');
}
