'use client';
import { useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { saveChatBackendAction, testCodexAction } from './actions';
export default function LocalCodexSettings({backend,enabled,config,piContextWindow=128000}:{backend:string;enabled:boolean;config:{executable:string;model:string;effort:string};piContextWindow?:number}) {
  const t=useT();const [selected,setSelected]=useState(backend);
  return <section className="surface border rounded-2xl p-4" style={{borderColor:'var(--border)'}}>
    <h2 className="text-[15px] font-semibold mb-2">{t('对话后端')}</h2>
    <p className="muted text-[12px] mb-3">{t('新对话使用这里选择的后端。已有对话保持原来的后端和记忆。')}</p>
    <form action={saveChatBackendAction} className="space-y-3">
      <select name="backend" value={selected} onChange={e=>setSelected(e.target.value)} className="w-full rounded-xl border p-2.5 bg-transparent" style={{borderColor:'var(--border)'}}>
        <option value="api">{t('API 模型')}</option><option value="pi">{t('内置 Pi（试用）')}</option><option value="codex" disabled={!enabled}>{t('本机 Codex')}</option>
      </select>
      {!enabled && <p className="muted text-[12px]">{t('桌面版支持本机 Codex；本地源码运行需启用 ENABLE_LOCAL_CODEX。')}</p>}
      {selected==='pi' && <>
        <p className="muted text-[12px]">{t('使用上方 API 配置，由 Pi 管理会话、工具循环与压缩。支持按附件读取及生成文件；更换模型后请新建对话。')}</p>
        <label className="block text-[12px]">{t('Pi 上下文窗口（token，不超过模型实际支持值）')}<input type="number" name="piContextWindow" min="8192" max="1000000" defaultValue={piContextWindow} className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{borderColor:'var(--border)'}} /></label>
      </>}
      {selected==='codex' && <>
        <p className="muted text-[12px]">{t('先在当前电脑安装并登录 Codex。使用该登录的额度；无需填写 DeepSeek API Key，仍需联网，电脑关闭后无法处理。')}</p>
        <label className="block text-[12px]">{t('Codex 可执行文件路径（可留空自动查找）')}<input name="codexPath" defaultValue={config.executable} className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{borderColor:'var(--border)'}} /></label>
        <label className="block text-[12px]">{t('Codex 模型（留空沿用本机默认）')}<input name="codexModel" defaultValue={config.model} className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{borderColor:'var(--border)'}} /></label>
        <label className="block text-[12px]">{t('对话推理强度')}<select name="codexEffort" defaultValue={config.effort} className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{borderColor:'var(--border)'}}><option value="low">{t('低')}</option><option value="medium">{t('中')}</option><option value="high">{t('高')}</option><option value="xhigh">{t('最高')}</option></select></label>
      </>}
      <button className="w-full rounded-xl bg-brand-500 text-white py-2.5 text-[15px]">{t('保存对话后端')}</button>
    </form>
    {enabled && <form action={testCodexAction} className="mt-2"><button className="w-full rounded-xl border py-2 text-[13px]" style={{borderColor:'var(--border)'}}>{t('测试本机 Codex（会消耗少量额度）')}</button></form>}
  </section>;
}
