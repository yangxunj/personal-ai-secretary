/** middleware（Edge runtime）用的 session 校验，只能用 Web Crypto */
const encoder = new TextEncoder();

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function verifySessionValue(value: string | undefined, secret: string): Promise<boolean> {
  if (!value || !value.includes('.')) return false;
  const [payload, sig] = value.split('.');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const expected = bytesToB64url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  if (expected !== sig) return false;
  try {
    const { exp } = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}
