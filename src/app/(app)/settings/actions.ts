'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { changePassword, createSession, destroySession } from '@/lib/auth';
import { checkThrottle, recordFailure, recordSuccess, sleep, clientKey } from '@/lib/login-throttle';
import { setAiConfig, clearAiConfig, testAiConfig, getAiConfig } from '@/lib/ai-config';
import { parseOwners, setOwners } from '@/lib/owners';
import { revalidatePath } from 'next/cache';

/**
 * 改密码。
 *
 * **走的是跟登录同一套限流**：这里也要输当前密码，等于多开了一个猜密码的
 * 窗口。只在登录页限流、把这儿敞着，攻击者拿一张过期前偷来的 cookie
 * 就能在这里不限次地试密码。
 */
export async function changePasswordAction(formData: FormData) {
  const oldPw = String(formData.get('current') ?? '');
  const newPw = String(formData.get('next') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (newPw !== confirm) redirect('/settings?e=' + encodeURIComponent('两次输入的新密码不一样'));

  const key = clientKey(await headers());
  const verdict = checkThrottle(key);
  if (!verdict.allowed) {
    redirect('/settings?e=' + encodeURIComponent(`错太多次了，${verdict.retryAfterSec} 秒后再试`));
  }
  await sleep(verdict.delayMs);

  const result = await changePassword(oldPw, newPw);
  if (!result.ok) {
    recordFailure(key);
    redirect('/settings?e=' + encodeURIComponent(result.error));
  }

  recordSuccess(key);
  // 版本号已经 +1，手上这张 cookie 也作废了 —— 重新签一张，
  // 否则改完密码的人自己先被踢出去，看起来像是操作失败了
  await createSession();
  redirect('/settings?ok=1');
}

export async function logoutAction() {
  await destroySession();
  redirect('/login');
}

// ---------- 模型配置 ----------

/**
 * 保存模型配置，**保存完立刻实测一次**。
 *
 * 为什么不是「保存」和「测试」两个按钮：分开的话使用者会填完就走，
 * 下次聊天才发现不通，而那时他已经忘了自己填过什么。存完当场验，
 * 错了当场说清错在哪（key 被拒 / 模型名不对 / 连不上），是这个表单
 * 唯一有价值的地方 —— 否则它只是个写数据库的框。
 */
export async function saveAiConfigAction(formData: FormData) {
  const saved = await setAiConfig({
    baseUrl: String(formData.get('baseUrl') ?? ''),
    apiKey: String(formData.get('apiKey') ?? ''),
    model: String(formData.get('model') ?? ''),
  });
  if (!saved.ok) redirect('/settings?aiE=' + encodeURIComponent(saved.error));

  const tested = await testAiConfig();
  if (!tested.ok) {
    // 注意仍然是保存成功的 —— 别让使用者以为白填了，而是告诉他存下了但不通
    redirect('/settings?aiE=' + encodeURIComponent('已保存，但试了一下不通：' + tested.error));
  }
  redirect('/settings?aiOk=' + encodeURIComponent('已保存并测试通过，现在就能用了'));
}

/** 只测不存 —— 用来确认当前这份配置还好使（比如怀疑余额用完了） */
export async function testAiConfigAction() {
  const r = await testAiConfig();
  if (!r.ok) redirect('/settings?aiE=' + encodeURIComponent(r.error));
  const cfg = await getAiConfig();
  redirect('/settings?aiOk=' + encodeURIComponent(`通了，当前用的是 ${cfg.model}`));
}

/** 退回安装包/`.env` 自带的那份配置 */
export async function resetAiConfigAction() {
  await clearAiConfig();
  redirect('/settings?aiOk=' + encodeURIComponent('已恢复成默认配置'));
}

// ---------- 家里的人 ----------

/** 任务能派给谁。改名不会连带改已有任务上的名字 —— 那些是历史记录 */
export async function saveOwnersAction(formData: FormData) {
  const r = parseOwners(String(formData.get('owners') ?? ''));
  if (!r.ok) redirect('/settings?mE=' + encodeURIComponent(r.error) + '#members');
  await setOwners(r.owners);
  revalidatePath('/tasks', 'layout');
  redirect('/settings?mOk=' + encodeURIComponent(`已保存：${r.owners.join('、')}`) + '#members');
}
