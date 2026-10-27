'use client';
import { useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { saveChatBackendAction, testCodexAction, saveWebSearchAction, saveCodexSearchAction } from './actions';
export default function LocalCodexSettings({backend,enabled,config,piContextWindow=128000,searchEnabled=false,searchConfigured=false}:{backend:string;enabled:boolean;config:{executable:string;model:string;effort:string;webSearchEnabled:boolean};piContextWindow?:number;searchEnabled?:boolean;searchConfigured?:boolean}) {
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
    {enabled && <form action={saveCodexSearchAction} className="mt-4 space-y-2 border-t pt-3" style={{borderColor:'var(--border)'}}>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="codexWebSearch" defaultChecked={config.webSearchEnabled} />{t('Codex 公开网络搜索（试用）')}</label>
      <p className="muted text-[12px]">{t('使用本机 Codex 的登录和额度，无需 DeepSeek 密钥。开启或关闭后，已有 Codex 对话的下一轮也生效，不会重建会话。')}</p>
      <p className="muted text-[12px]">{t('仅允许公开搜索和网页读取，搜索词和网页地址会发送至搜索服务。页面生成和连接测试不启用搜索。')}</p>
      <button className="w-full rounded-xl border py-2 text-[13px]" style={{borderColor:'var(--border)'}}>{t('保存 Codex 搜索设置')}</button>
    </form>}
    <form action={saveWebSearchAction} className="mt-4 space-y-2 border-t pt-3" style={{borderColor:'var(--border)'}}>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="webSearchEnabled" defaultChecked={searchEnabled} />{t('Pi 公开网络搜索（试用）')}</label>
      <p className="muted text-[12px]">{t('仅影响 Pi 的后续回复，已有会话也生效。通过 DeepSeek 搜索和读取公开网页，会产生独立调用费用；每轮最多 6 次。')}</p>
      <p className="muted text-[12px]">{t('搜索词和网页地址会发送给 DeepSeek。请勿要求搜索私人邮件、附件原文或其他敏感内容。')}</p>
      <label className="block text-[12px]">{t('DeepSeek 搜索专用 API Key（留空保留）')}<input type="password" name="webSearchApiKey" autoComplete="new-password" className="mt-1 w-full rounded-xl border p-2.5 bg-transparent" style={{borderColor:'var(--border)'}} /></label>
      <p className="muted text-[12px]">{searchConfigured?t('搜索密钥可用。'):t('尚无搜索密钥。使用 DeepSeek 官方聊天接口时可复用聊天密钥；其他服务商需填写专用密钥。')}</p>
      <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" name="clearSearchKey" />{t('清除已保存的搜索专用密钥（仍可使用环境变量或官方聊天密钥）')}</label>
      <button className="w-full rounded-xl border py-2 text-[13px]" style={{borderColor:'var(--border)'}}>{t('保存网络搜索设置')}</button>
    </form>
  </section>;
}
