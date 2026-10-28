'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';
import { saveChatBackendAction, testCodexAction, saveWebSearchKeyAction } from './actions';

export default function HarnessSettings({ backend, enabled, config, searchConfigured = false, piSettings }: {
  backend: string;
  enabled: boolean;
  config: { executable: string; model: string; effort: string };
  searchConfigured?: boolean;
  piSettings: ReactNode;
}) {
  const t = useT();
  const [selected, setSelected] = useState<'pi' | 'codex'>(backend === 'codex' ? 'codex' : 'pi');
  const buttons = useRef<Partial<Record<'pi' | 'codex', HTMLButtonElement | null>>>({});
  const tabs = enabled ? ['pi', 'codex'] as const : ['pi'] as const;

  return <div className="space-y-4">
    <section className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
      <h2 className="text-[15px] font-semibold mb-2">{t('对话后端')}</h2>
      <p className="muted text-[12px] mb-3">{t('当前新对话使用：{backend}', { backend: backend === 'codex' ? t('本机 Codex') : t('内置 Pi（试用）') })}</p>
      <div role="tablist" aria-label={t('对话后端')} className="grid grid-cols-2 gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--border)' }}>
        {(['pi', 'codex'] as const).map(tab => <button key={tab} type="button" role="tab"
          ref={el => { buttons.current[tab] = el; }}
          id={`harness-tab-${tab}`} aria-controls={`harness-panel-${tab}`}
          aria-selected={selected === tab} tabIndex={selected === tab ? 0 : -1}
          disabled={tab === 'codex' && !enabled}
          onClick={() => setSelected(tab)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1]
              : tabs.length === 1 ? 'pi' : selected === 'pi' ? 'codex' : 'pi';
            setSelected(next); buttons.current[next]?.focus();
          }}
          className={`rounded-lg px-2 py-2.5 text-sm transition disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-brand-500 ${selected === tab ? 'bg-brand-500/10 text-brand-500 font-semibold' : 'muted hover:bg-brand-500/5'}`}
        >{tab === 'pi' ? t('内置 Pi（试用）') : t('本机 Codex')}</button>)}
      </div>
      <p className="muted text-[12px] mt-3">{t('切换查看配置不会改变当前后端；保存后，新对话使用所选后端，已有对话保持原来的后端和记忆。')}</p>
      {!enabled && <p className="muted text-[12px] mt-2">{t('桌面版支持本机 Codex；本地源码运行需启用 ENABLE_LOCAL_CODEX。')}</p>}
    </section>

    {/* Keep both forms mounted so switching harnesses preserves unsaved inputs. */}
    <div role="tabpanel" id="harness-panel-pi" aria-labelledby="harness-tab-pi" hidden={selected !== 'pi'} className={selected === 'pi' ? 'space-y-4' : 'hidden'}>
      {piSettings}
      <section className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
        <form action={saveChatBackendAction}>
          <input type="hidden" name="backend" value="pi" />
          <button className="w-full rounded-xl bg-brand-500 text-white py-2.5 text-[15px]">{t('将 Pi 用于新对话')}</button>
        </form>
        <p className="muted text-[12px] mt-3">{t('公开网络搜索已默认启用，AI 会按需搜索和读取公开网页。')}{t('使用 DeepSeek 官方接口时复用聊天密钥，搜索按调用计费。')}</p>
        <details className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <summary className="cursor-pointer text-[13px]">{t('高级：搜索专用密钥')}</summary>
          <form action={saveWebSearchKeyAction} className="mt-3 space-y-2">
            <p className="muted text-[12px]">{t('搜索词和网页地址会发送给 DeepSeek。请勿要求搜索私人邮件、附件原文或其他敏感内容。')}</p>
            <label className="block text-[12px]">{t('DeepSeek 搜索专用 API Key（留空保留）')}<input type="password" name="webSearchApiKey" autoComplete="new-password" className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }} /></label>
            <p className="muted text-[12px]">{searchConfigured ? t('搜索密钥可用。') : t('尚无搜索密钥。使用 DeepSeek 官方聊天接口时可复用聊天密钥；其他服务商需填写专用密钥。')}</p>
            <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" name="clearSearchKey" />{t('清除已保存的搜索专用密钥（仍可使用环境变量或官方聊天密钥）')}</label>
            <button className="w-full rounded-xl border py-2 text-[13px]" style={{ borderColor: 'var(--border)' }}>{t('保存搜索密钥')}</button>
          </form>
        </details>
      </section>
    </div>

    <div role="tabpanel" id="harness-panel-codex" aria-labelledby="harness-tab-codex" hidden={selected !== 'codex'} className={selected === 'codex' ? 'space-y-4' : 'hidden'}>
      <section className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-[15px] font-semibold mb-2">{t('Codex 配置')}</h2>
        <p className="muted text-[12px] mb-3">{t('先在当前电脑安装并登录 Codex。使用该登录的额度；无需填写 DeepSeek API Key，仍需联网，电脑关闭后无法处理。')}</p>
        <form action={saveChatBackendAction} className="space-y-3">
          <input type="hidden" name="backend" value="codex" />
          <label className="block text-[12px]">{t('Codex 可执行文件路径（可留空自动查找）')}<input name="codexPath" defaultValue={config.executable} className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }} /></label>
          <label className="block text-[12px]">{t('Codex 模型（留空沿用本机默认）')}<input name="codexModel" defaultValue={config.model} className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }} /></label>
          <label className="block text-[12px]">{t('对话推理强度')}<select name="codexEffort" defaultValue={config.effort} className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }}><option value="low">{t('低')}</option><option value="medium">{t('中')}</option><option value="high">{t('高')}</option><option value="xhigh">{t('最高')}</option></select></label>
          <button disabled={!enabled} className="w-full rounded-xl bg-brand-500 text-white py-2.5 text-[15px] disabled:opacity-40">{t('保存并使用 Codex')}</button>
        </form>
        {enabled && <form action={testCodexAction} className="mt-2"><button className="w-full rounded-xl border py-2 text-[13px]" style={{ borderColor: 'var(--border)' }}>{t('测试本机 Codex（会消耗少量额度）')}</button></form>}
        <p className="muted text-[12px] mt-3">{t('公开网络搜索已默认启用，AI 会按需搜索和读取公开网页。')}{t('使用本机 Codex 的登录和额度，无需 DeepSeek 密钥。')}</p>
      </section>
    </div>
  </div>;
}
