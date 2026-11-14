'use client';

import { useActionState } from 'react';
import { useT } from '@/lib/i18n/client';
import { savePptSettingsAction } from './actions';

export default function PptSettings({ hasKey, chatApiReady, chatModel, managedAddress }: { hasKey: boolean; chatApiReady: boolean; chatModel: string; managedAddress: boolean }) {
  const t = useT();
  const [result, action, pending] = useActionState(savePptSettingsAction, { ok: false, message: '' });
  return <section id="ppt" className="surface border rounded-2xl p-4 scroll-mt-4" style={{ borderColor: 'var(--border)' }}>
    <h2 className="text-[15px] font-semibold mb-1">{t('PPT 制作模型')}</h2>
    <p className="muted text-[12px] leading-relaxed mb-3">{t('大纲和页面描述复用 Pi 对话 API 配置（例如 DeepSeek）；图片使用 OpenRouter 的 Meta Muse。')}</p>
    <p className="muted text-[12px] mb-3">{chatApiReady ? t('当前对话 API 模型：{model}', { model: chatModel }) : t('请先配置对话 API 的地址、模型和密钥。')}</p>
    <form action={action} className="space-y-3">
      <label className="block text-sm">{t('OpenRouter API Key')}
        <input name="openrouterApiKey" type="password" autoComplete="new-password" placeholder={hasKey || result.ok ? t('已配置，留空不改') : t('还没填')}
          className="mt-1 w-full rounded-xl border px-3 py-2 bg-transparent" style={{ borderColor: 'var(--border)' }} />
      </label>
      {result.message && <p role={result.ok ? 'status' : 'alert'} className={`text-[13px] ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{result.message}</p>}
      <button disabled={pending} className="w-full rounded-xl bg-brand-500 text-white py-2.5 text-[15px] disabled:opacity-50">{pending ? t('正在保存…') : t('保存 PPT 配置')}</button>
    </form>
    <p className="muted text-[11px] leading-relaxed mt-3">{t('设置用于项目内 PPT 引擎，不会修改原有 Banana Slides 服务。已有对话使用的配置不受影响。')}</p>
    {!managedAddress && <p role="status" className="text-[12px] mt-2 text-amber-700 dark:text-amber-400">{t('当前尚未连接项目内 PPT 引擎，保存后需先启动并连接该引擎。')}</p>}
  </section>;
}
