'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { changePassword, createSession, destroySession } from '@/lib/auth';
import { checkThrottle, recordFailure, recordSuccess, sleep, clientKey } from '@/lib/login-throttle';
import { setAiConfig, clearAiConfig, testAiConfig, getAiConfig } from '@/lib/ai-config';
import { parseOwners, setOwners } from '@/lib/owners';
import { revalidatePath } from 'next/cache';
import { getT, setLocale } from '@/lib/i18n/server';
import { isLocale } from '@/lib/i18n/core';
import { sessionIsCurrent } from '@/lib/auth';
import { db } from '@/lib/db';
import { diagnoseCodex, getCodexConfig, localCodexEnabled, openCodex } from '@/lib/codex/config';
import { denyRequest, runTurn } from '@/lib/codex/protocol.mjs';

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
  const t = await getT();

  if (newPw !== confirm) redirect('/settings?e=' + encodeURIComponent(t('两次输入的新密码不一样')));

  const key = clientKey(await headers());
  const verdict = checkThrottle(key);
  if (!verdict.allowed) {
    redirect('/settings?e=' + encodeURIComponent(t('错太多次了，{n} 秒后再试', { n: verdict.retryAfterSec })));
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

  const t = await getT();
  const tested = await testAiConfig();
  if (!tested.ok) {
    // 注意仍然是保存成功的 —— 别让使用者以为白填了，而是告诉他存下了但不通
    redirect('/settings?aiE=' + encodeURIComponent(t('已保存，但试了一下不通：') + tested.error));
  }
  redirect('/settings?aiOk=' + encodeURIComponent(t('已保存并测试通过，现在就能用了')));
}

/** 只测不存 —— 用来确认当前这份配置还好使（比如怀疑余额用完了） */
export async function testAiConfigAction() {
  const r = await testAiConfig();
  if (!r.ok) redirect('/settings?aiE=' + encodeURIComponent(r.error));
  const cfg = await getAiConfig();
  const t = await getT();
  redirect('/settings?aiOk=' + encodeURIComponent(t('通了，当前用的是 {model}', { model: cfg.model })));
}

/** 退回安装包/`.env` 自带的那份配置 */
export async function resetAiConfigAction() {
  await clearAiConfig();
  const t = await getT();
  redirect('/settings?aiOk=' + encodeURIComponent(t('已恢复成默认配置')));
}

/** ASR 独立保存；空密钥保留原值，密钥不放进 URL 或返回给浏览器。 */
export async function saveAsrConfigAction(form: FormData) {
  if (!(await sessionIsCurrent())) redirect('/login');
  const t = await getT();
  const baseUrl = String(form.get('asrBaseUrl') ?? '').trim().replace(/\/+$/, '');
  const model = String(form.get('asrModel') ?? '').trim();
  const apiKey = String(form.get('asrApiKey') ?? '').replace(/\s+/g, '');
  let validUrl = false;
  try {
    const url = new URL(baseUrl);
    validUrl = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { /* invalid */ }
  if (!validUrl || !model || (apiKey && apiKey.length < 8)) {
    redirect('/settings?asrE=' + encodeURIComponent(t('请检查语音识别地址、模型和密钥，地址必须使用 HTTPS')) + '#voice');
  }
  const values = [['asr.baseUrl', baseUrl], ['asr.model', model], ...(apiKey ? [['asr.apiKey', apiKey]] : [])];
  await db.$transaction(values.map(([key, value]) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } })));
  revalidatePath('/settings');
  redirect('/settings?asrOk=1#voice');
}

export async function saveTtsConfigAction(form: FormData) {
  if (!(await sessionIsCurrent())) redirect('/login');
  const t = await getT();
  const baseUrl = String(form.get('ttsBaseUrl') ?? '').trim().replace(/\/+$/, '');
  const model = String(form.get('ttsModel') ?? '').trim();
  const voice = String(form.get('ttsVoice') ?? '').trim();
  const apiKey = String(form.get('ttsApiKey') ?? '').replace(/\s+/g, '');
  let validUrl = false;
  try {
    const url = new URL(baseUrl);
    validUrl = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { /* invalid */ }
  if (!validUrl || !model || !/^[a-zA-Z0-9_-]{1,80}$/.test(voice) || (apiKey && apiKey.length < 8)) {
    redirect('/settings?ttsE=' + encodeURIComponent(t('请检查朗读地址、模型、音色和密钥，地址必须使用 HTTPS')) + '#speech');
  }
  const values = [['tts.baseUrl', baseUrl], ['tts.model', model], ['tts.voice', voice], ...(apiKey ? [['tts.apiKey', apiKey]] : [])];
  await db.$transaction(values.map(([key, value]) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } })));
  revalidatePath('/settings');
  redirect('/settings?ttsOk=1#speech');
}

// ---------- 实时语音 ----------
export async function saveRealtimeConfigAction(form: FormData) {
  if (!(await sessionIsCurrent())) redirect('/login');
  const { validRealtimeConfig } = await import('@/lib/realtime/config');
  const t = await getT();
  const config = { endpoint: String(form.get('realtimeEndpoint') || '').trim(), model: String(form.get('realtimeModel') || '').trim(),
    voice: String(form.get('realtimeVoice') || '').trim(), apiKey: String(form.get('realtimeApiKey') || '').replace(/\s+/g, '') };
  if (!validRealtimeConfig(config) || config.apiKey && config.apiKey.length < 8) redirect('/settings?rtE=' + encodeURIComponent(t('实时语音配置无效，请检查地址、模型和音色')) + '#realtime');
  const values = Object.entries(config).filter(([key, value]) => key !== 'apiKey' || !!value);
  await db.$transaction(values.map(([key, value]) => db.setting.upsert({ where: { key: `realtime.${key}` }, create: { key: `realtime.${key}`, value }, update: { value } })));
  revalidatePath('/settings'); redirect('/settings?rtOk=1#realtime');
}

// ---------- 家里的人 ----------
/** 任务能派给谁。改名不会连带改已有任务上的名字 —— 那些是历史记录 */
export async function saveOwnersAction(formData: FormData) {
  const t = await getT();
  const r = parseOwners(String(formData.get('owners') ?? ''), t);
  if (!r.ok) redirect('/settings?mE=' + encodeURIComponent(r.error) + '#members');
  await setOwners(r.owners);
  revalidatePath('/tasks', 'layout');
  redirect('/settings?mOk=' + encodeURIComponent(t('已保存：{names}', { names: r.owners.join(t('、')) })) + '#members');
}

/**
 * 界面语言。存库不存 cookie（见 lib/i18n/server.ts）。
 * 整个布局都要按新语言重渲，所以 revalidate 根 layout。
 */
export async function setLocaleAction(formData: FormData) {
  const v = formData.get('locale');
  if (isLocale(v)) await setLocale(v);
  revalidatePath('/', 'layout');
  redirect('/settings?tab=general');
}


export type HarnessSaveResult = { ok: boolean; message: string; backend?: 'pi' | 'codex' };

/** Validate the selected configuration first, then save it and the default together. */
export async function saveHarnessSettingsAction(_previous: HarnessSaveResult, form: FormData): Promise<HarnessSaveResult> {
  if (!(await sessionIsCurrent())) redirect('/login');
  const t = await getT();
  const backend = String(form.get('backend') || '');
  if (backend !== 'pi' && backend !== 'codex') return { ok: false, message: t('请选择对话后端') };
  if (backend === 'pi') {
    const current = await getAiConfig();
    const input = { baseUrl: String(form.get('baseUrl') ?? '').trim(), model: String(form.get('model') ?? '').trim(), apiKey: String(form.get('apiKey') ?? '').replace(/\s+/g, '') };
    if (input.apiKey && input.apiKey.length < 8) return { ok: false, message: t('API Key 看起来不完整') };
    const candidate = { ...current, ...input, apiKey: input.apiKey || current.apiKey };
    const tested = await testAiConfig(candidate);
    if (!tested.ok) return { ok: false, message: tested.error };
    const saved = await setAiConfig(input, { useForNewChats: true });
    if (!saved.ok) return { ok: false, message: saved.error };
  } else {
    if (!localCodexEnabled()) return { ok: false, message: t('桌面版支持本机 Codex；本地源码运行需启用 ENABLE_LOCAL_CODEX。') };
    const current = await getCodexConfig();
    const candidate = { ...current, executable: String(form.get('codexPath') ?? current.executable).trim(), model: String(form.get('codexModel') ?? current.model).trim(), effort: String(form.get('codexEffort') ?? current.effort) };
    if (!['low', 'medium', 'high', 'xhigh'].includes(candidate.effort)) return { ok: false, message: t('对话推理强度无效') };
    try {
      const result = await diagnoseCodex(candidate);
      const model = result.models.find((m: { id: string }) => m.id === result.model);
      if (!model) throw new Error('Configured model is not in the installed Codex model catalog.');
      if (!model.efforts.includes(candidate.effort)) throw new Error('Configured reasoning effort is not supported by this model.');
    } catch (error) { return { ok: false, message: t('Codex 连接检查失败：') + (error instanceof Error ? error.message : String(error)) }; }
    const values = [['codex.path', candidate.executable], ['codex.model', candidate.model], ['codex.effort', candidate.effort], ['ai.backend', 'codex']];
    await db.$transaction(values.map(([key, value]) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } })));
  }
  revalidatePath('/settings');
  revalidatePath('/chat', 'layout');
  return { ok: true, message: t('已保存，新对话使用所选后端。'), backend };
}

export async function testCodexAction() {
  if(!(await sessionIsCurrent()))redirect('/login');
  const t=await getT();let problem='';
  try {
    const {client,cfg,cwd,config}=await openCodex();
    try {
      client.on('request',msg=>denyRequest(client,msg));
      const r=await client.request('thread/start',{cwd,config,ephemeral:true,sandbox:'read-only',approvalPolicy:'on-request',...(cfg.model?{model:cfg.model}:{}),baseInstructions:'Reply only OK. Do not use any tools.',dynamicTools:[]});
      const reply=await runTurn(client,{threadId:r.thread.id,input:[{type:'text',text:'Reply OK'}],effort:cfg.effort,timeoutMs:60000});
      if(!reply.trim())throw new Error('No reply');
    } finally {client.close();}
  }catch(e){problem=e instanceof Error?e.message:String(e);}
  if(problem)redirect('/settings?aiE='+encodeURIComponent(t('Codex 测试失败：')+problem));
  redirect('/settings?aiOk='+encodeURIComponent(t('Codex 已完成真实回复，登录和模型调用可用。')));
}

export async function saveWebSearchKeyAction(form:FormData) {
  if(!(await sessionIsCurrent()))redirect('/login');
  const t=await getT();
  const key=String(form.get('webSearchApiKey')||'').replace(/\s+/g,'');
  if(key&&(key.length<8||key.length>512))redirect('/settings?aiE='+encodeURIComponent(t('API Key 看起来不完整')));
  await db.$transaction(async tx=>{
    if(key)await tx.setting.upsert({where:{key:'webSearch.apiKey'},create:{key:'webSearch.apiKey',value:key},update:{value:key}});
    else if(form.get('clearSearchKey')==='on')await tx.setting.deleteMany({where:{key:'webSearch.apiKey'}});
  });
  revalidatePath('/settings');
  redirect('/settings?aiOk='+encodeURIComponent(t('网络搜索设置已保存。')));
}
