'use client';

import { startTransition, useActionState, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';
import { saveHarnessSettingsAction, saveWebSearchKeyAction, resetAiConfigAction, type HarnessSaveResult } from './actions';

export default function HarnessSettings({ backend, enabled, config, searchConfigured = false, hasCustomAiConfig = false, piSettings }: {
  backend: string;
  enabled: boolean;
  config: { executable: string; model: string; effort: string };
  searchConfigured?: boolean;
  hasCustomAiConfig?: boolean;
  piSettings: ReactNode;
}) {
  const t = useT();
  const [selected, setSelected] = useState<'pi' | 'codex'>(backend === 'codex' ? 'codex' : 'pi');
  const [codexPath, setCodexPath] = useState(config.executable);
  const [codexModel, setCodexModel] = useState(config.model);
  const [codexEffort, setCodexEffort] = useState(config.effort);
  const [submittedBackend, setSubmittedBackend] = useState<'pi' | 'codex' | null>(null);
  const [result, save, pending] = useActionState<HarnessSaveResult, FormData>(saveHarnessSettingsAction, { ok: false, message: '' });
  const active = result.backend || backend;

  return <div className="space-y-4">
    <form id="harness-settings-form" method="post" onSubmit={event => {
      event.preventDefault();
      const draft = new FormData(event.currentTarget);
      setSubmittedBackend(selected);
      // Dispatch explicitly to avoid React's automatic post-action form reset.
      startTransition(() => save(draft));
    }} className="space-y-4">
      <section className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-[15px] font-semibold mb-2">{t('对话后端')}</h2>
        <p className="muted text-[12px] mb-3">{t('当前新对话使用：{backend}', { backend: active === 'codex' ? t('本机 Codex') : t('内置 Pi（试用）') })}</p>
        <fieldset disabled={pending}>
          <legend className="sr-only">{t('对话后端')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['pi', 'codex'] as const).map(value => <label key={value}
              className={`flex items-center justify-center gap-2 rounded-xl border px-2 py-3 text-sm ${selected === value ? 'border-brand-500 bg-brand-500/10 text-brand-500 font-medium' : ''} ${value === 'codex' && !enabled ? 'opacity-40' : 'cursor-pointer'}`}
              style={selected === value ? undefined : { borderColor: 'var(--border)' }}>
              <input type="radio" name="backend" value={value} checked={selected === value}
                aria-controls={`harness-panel-${value}`} disabled={value === 'codex' && !enabled} onChange={() => setSelected(value)} />
              {value === 'pi' ? t('内置 Pi（试用）') : t('本机 Codex')}
            </label>)}
          </div>
        </fieldset>
        <p className="muted text-[12px] mt-3">{t('选择后填写对应配置，保存成功后用于新对话。已有对话保留原后端，另一种后端的配置也会保留。')}</p>
        {!enabled && <p className="muted text-[12px] mt-2">{t('桌面版支持本机 Codex；本地源码运行需启用 ENABLE_LOCAL_CODEX。')}</p>}
      </section>

      {/* Disabled hidden fieldsets retain drafts while excluding irrelevant validation and form fields. */}
      <fieldset id="harness-panel-pi" aria-label={t('Pi 模型配置')} hidden={selected !== 'pi'} disabled={selected !== 'pi' || pending}
        className={selected === 'pi' ? 'min-w-0 space-y-4' : 'hidden'}>
        {piSettings}
        <p className="muted text-[12px] px-1">{t('公开网络搜索已默认启用，AI 会按需搜索和读取公开网页。')}{t('使用 DeepSeek 官方接口时复用聊天密钥，搜索按调用计费。')}</p>
      </fieldset>

      <fieldset id="harness-panel-codex" aria-label={t('Codex 配置')} hidden={selected !== 'codex'} disabled={selected !== 'codex' || pending}
        className={selected === 'codex' ? 'min-w-0 surface border rounded-2xl p-4 space-y-3' : 'hidden'} style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-[15px] font-semibold">{t('Codex 配置')}</h2>
        <p className="muted text-[12px]">{t('先在当前电脑安装并登录 Codex。使用该登录的额度；无需填写 DeepSeek API Key，仍需联网，电脑关闭后无法处理。')}</p>
        <label className="block text-[12px]">{t('Codex 可执行文件路径（可留空自动查找）')}<input name="codexPath" value={codexPath} onChange={event => setCodexPath(event.target.value)} className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }} /></label>
        <label className="block text-[12px]">{t('Codex 模型（留空沿用本机默认）')}<input name="codexModel" value={codexModel} onChange={event => setCodexModel(event.target.value)} className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }} /></label>
        <label className="block text-[12px]">{t('对话推理强度')}<select name="codexEffort" value={codexEffort} onChange={event => setCodexEffort(event.target.value)} className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }}><option value="low">{t('低')}</option><option value="medium">{t('中')}</option><option value="high">{t('高')}</option><option value="xhigh">{t('最高')}</option></select></label>
        <p className="muted text-[12px]">{t('公开网络搜索已默认启用，AI 会按需搜索和读取公开网页。')}{t('使用本机 Codex 的登录和额度，无需 DeepSeek 密钥。')}</p>
      </fieldset>
    </form>

    <div hidden={selected !== 'pi'} className={selected === 'pi' ? '' : 'hidden'}>
      <details className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
        <summary className="cursor-pointer text-[13px]">{t('高级：搜索专用密钥')}</summary>
        <form action={saveWebSearchKeyAction} className="mt-3 space-y-2">
          <p className="muted text-[12px]">{t('搜索词和网页地址会发送给 DeepSeek。请勿要求搜索私人邮件、附件原文或其他敏感内容。')}</p>
          <label className="block text-[12px]">{t('DeepSeek 搜索专用 API Key（留空保留）')}<input type="password" name="webSearchApiKey" autoComplete="new-password" className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }} /></label>
          <p className="muted text-[12px]">{searchConfigured ? t('搜索密钥可用。') : t('尚无搜索密钥。使用 DeepSeek 官方聊天接口时可复用聊天密钥；其他服务商需填写专用密钥。')}</p>
          <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" name="clearSearchKey" />{t('清除已保存的搜索专用密钥（仍可使用环境变量或官方聊天密钥）')}</label>
          <button className="w-full rounded-xl border py-2 text-[13px]" style={{ borderColor: 'var(--border)' }}>{t('保存搜索密钥')}</button>
        </form>
        {hasCustomAiConfig && <form action={resetAiConfigAction} className="mt-3"><button className="w-full rounded-xl border py-2 text-[13px]" style={{ borderColor: 'var(--border)' }}>{t('恢复默认')}</button></form>}
      </details>
    </div>
    {result.message && submittedBackend === selected && <p role={result.ok ? 'status' : 'alert'} className={`text-[13px] px-1 ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{result.message}</p>}
    <button form="harness-settings-form" disabled={pending} aria-busy={pending} className="w-full rounded-xl bg-brand-500 text-white py-2.5 text-[15px] disabled:opacity-50">
      {pending ? t('正在检查并保存…') : t('保存并用于新对话')}
    </button>
  </div>;
}
