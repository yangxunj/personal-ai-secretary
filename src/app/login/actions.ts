'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { verifyPassword, createSession } from '@/lib/auth';
import { checkThrottle, recordFailure, recordSuccess, sleep, clientKey } from '@/lib/login-throttle';

/**
 * 登录成功后要跳去哪。
 *
 * `startsWith('/')` 一个条件不够：`//evil.com` 也以 `/` 开头，浏览器会把它
 * 当协议相对 URL 跳到站外。反斜杠同理（部分浏览器把 `/\evil.com` 当 `//`）。
 */
function safeNext(from: string): string {
  if (!from.startsWith('/')) return '/';
  if (from.startsWith('//') || from.startsWith('/\\')) return '/';
  return from;
}

export async function login(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const from = String(formData.get('from') ?? '/');
  const key = clientKey(await headers());

  const verdict = checkThrottle(key);
  if (!verdict.allowed) {
    redirect(`/login?e=locked&s=${verdict.retryAfterSec}&from=${encodeURIComponent(from)}`);
  }

  // 递增延迟：正确的密码也等一样的时间，免得用响应快慢反推密码对不对
  await sleep(verdict.delayMs);

  if (!(await verifyPassword(password))) {
    recordFailure(key);
    redirect(`/login?e=1&from=${encodeURIComponent(from)}`);
  }

  recordSuccess(key);
  await createSession();
  redirect(safeNext(from));
}
