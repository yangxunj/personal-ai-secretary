'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n/client';
import { MAIL_ERRORS } from '@/lib/mail/errors';

type Finding = { id: string; importance: string; summary: string; action: string; evidence: string; subject: string; from: string; date: string; dueDate: string | null; sourceUrl: string | null; status?: string; taskId?: string; bodyTruncated?: boolean; attachments?: string[] };
type Snapshot = { connected: boolean; account: string | null; toolReady: boolean; clientReady: boolean; authorizing: boolean; authError?: string; authUrl?: string;
  running: boolean; enabled: boolean; analysisApproved: boolean; notifications: boolean; intervalMinutes: number; lastSuccessAt: string | null;
  lastError: string | null; totalAnalyzed: number; morePending: boolean; findings: Finding[]; analysisTarget: { label: string; key: string } };
declare global { interface Window { desktopGmail?: { invoke(action: string, input?: unknown): Promise<Snapshot & { error?: string; taskId?: string }> } } }

export default function MailPanel() {
  const t = useT();
  const [available, setAvailable] = useState<boolean | null>(null), [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [draft, setDraft] = useState({ approved: false, enabled: false, notifications: false, interval: 60, targetKey: '' });
  const [dirty, setDirty] = useState(false), [showAll, setShowAll] = useState(false);
  const [createdTask, setCreatedTask] = useState('');
  const describeError = (code: string) => MAIL_ERRORS[code] ? t(MAIL_ERRORS[code]) : t('邮件操作失败，请重试。');
  useEffect(() => {
    setAvailable(!!window.desktopGmail);
    if (!window.desktopGmail) return;
    let disposed = false, checking = false;
    const read = async () => {
      if (checking) return; checking = true;
      try {
        const result = await window.desktopGmail!.invoke('status');
        if (disposed) return;
        if (result.error) setError(result.error); else setData(result);
      } catch { if (!disposed) setError('MAIL_OPERATION_FAILED'); }
      finally { checking = false; }
    };
    void read(); const timer = setInterval(() => { if (!document.hidden) void read(); }, 2500);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (data && !dirty) setDraft({ approved: data.analysisApproved, enabled: data.enabled, notifications: data.notifications, interval: data.intervalMinutes, targetKey: data.analysisTarget.key });
  }, [data, dirty]);
  async function command(action: string, input?: unknown) {
    setBusy(true); setError('');
    try {
      const result = await window.desktopGmail!.invoke(action, input);
      if (result.error) setError(result.error);
      else {
        setData(result);
        if (action === 'task' && result.taskId) setCreatedTask(result.taskId);
        if (action === 'configure' || action === 'disconnect') setDirty(false);
        if (action === 'disconnect') setCreatedTask('');
      }
    } catch { setError('MAIL_OPERATION_FAILED'); }
    finally { setBusy(false); }
  }
  const locked = busy || !!data?.running || !!data?.authorizing;
  const button = 'rounded-xl border px-3 py-2 text-sm disabled:opacity-40';
  const surface = 'surface border rounded-2xl p-4 space-y-3';
  const findings = (data?.findings || []).filter(f => showAll || !['done', 'ignored'].includes(f.status || ''));
  return <div className="px-4 py-4 space-y-4">
    <p className="muted text-sm">{t('Gmail 桌面试点：只读邮件，识别需要关注的信息，由你决定是否转为待办。')}</p>
    {available === false && <div className={surface}>{t('请在桌面应用中打开邮件功能。网页版和手机访问暂不支持连接或读取邮箱。')}</div>}
    {available && !data && !error && <p>{t('正在读取连接状态…')}</p>}
    {error && <p role="alert" className="text-sm text-red-500">{describeError(error)}</p>}
    {createdTask && <p role="status" className="text-sm text-emerald-600">{t('待办已创建。')}{' '}<Link className="underline" href={'/tasks/' + createdTask}>{t('查看待办')}</Link></p>}
    {!data && available && error === 'MAIL_STATE_INVALID' && <div className={surface}>
      {!confirmDisconnect ? <button className={button} disabled={busy} onClick={() => setConfirmDisconnect(true)}>{t('断开并清除本机邮件数据')}</button> : <>
        <p className="text-sm">{t('将停止同步并删除本机 Gmail 凭据、摘要和扫描记录；已经创建的待办会保留。也可在 Google 账户中撤销应用授权。')}</p>
        <button className={button} disabled={busy} onClick={() => { void command('disconnect'); setConfirmDisconnect(false); }}>{t('确认断开')}</button>
      </>}
    </div>}
    {data && <>
      <section className={surface} style={{ borderColor: 'var(--border)' }}>
        <h2 className="font-semibold">{t('Gmail 连接')}</h2>
        <p className="text-sm break-all">{data.connected ? data.account : t('尚未连接 Gmail')}</p>
        {!data.connected && <>
          <p className="muted text-sm">{t('在 Google Cloud 启用 Gmail API，创建 Desktop 应用的 OAuth 客户端，并将自己加入测试用户。下载 JSON 后在这里导入，再通过系统浏览器授权。')}</p>
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-sm text-brand-500 underline">{t('打开 Google Cloud 配置')}</a>
          <p className="muted text-sm">{t('首次同步范围是最近 7 天，正文最多读取 12000 字符，附件仅显示名称。之后只处理新增邮件。')}</p>
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={locked} onClick={() => void command('import')}>{data.clientReady ? t('更换 OAuth 配置') : t('导入 OAuth 配置')}</button>
            <button className={button} disabled={locked || !data.clientReady || !data.toolReady} onClick={() => void command('connect')}>{t('连接 Gmail')}</button>
          </div>
          {!data.toolReady && <p role="alert" className="text-sm text-red-500">{describeError('MAIL_TOOL_MISSING')}</p>}
        </>}
        {data.authorizing && <div role="status" className="space-y-2">
          <p className="text-sm">{t('请在这台电脑的系统浏览器中完成 Google 授权。')}</p>
          {data.authUrl && <a href={data.authUrl} target="_blank" rel="noopener noreferrer" className="text-brand-500 underline text-sm">{t('打开授权页面')}</a>}
          <button className={button} disabled={busy} onClick={() => void command('cancel')}>{t('取消授权')}</button>
        </div>}
        {data.authError && <p className="text-sm text-red-500" role="alert">{describeError(data.authError)}</p>}
        <p className="muted text-xs">{t('Google Testing 状态下授权通常 7 天过期；需要时重新连接。凭据保存在本机独立目录，不随安装包分发。')}</p>
      </section>
      {data.connected && <>
        <section className={surface} style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-semibold">{t('邮件分析与定期检查')}</h2>
          <p className="text-sm break-all">{t('分析服务：')}{data.analysisTarget.label}</p>
          <p className="muted text-sm">{t('开启后，新邮件正文将发送给上面的分析服务，消耗对应额度。仅保存摘要、证据和处理结果，不保存完整正文；邮件内容不能执行平台操作。')}</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.approved} disabled={locked} onChange={e => { setDirty(true); setDraft({ ...draft, approved: e.target.checked, targetKey: data.analysisTarget.key, ...(!e.target.checked ? { enabled: false } : {}) }); }} />{t('允许上述服务分析此邮箱的邮件')}</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.enabled} disabled={locked || !draft.approved} onChange={e => { setDirty(true); setDraft({ ...draft, enabled: e.target.checked }); }} />{t('应用运行期间定期检查邮件')}</label>
          <label className="flex flex-wrap items-center gap-2 text-sm">{t('检查间隔')}<select className="border rounded-lg bg-transparent p-1" disabled={locked} value={draft.interval} onChange={e => { setDirty(true); setDraft({ ...draft, interval: Number(e.target.value) }); }}>
            {[10, 30, 60].map(n => <option key={n} value={n}>{t('{n} 分钟', { n })}</option>)}
          </select></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.notifications} disabled={locked} onChange={e => { setDirty(true); setDraft({ ...draft, notifications: e.target.checked }); }} />{t('发现新线索时显示桌面通知')}</label>
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={locked} onClick={() => void command('configure', { analysisApproved: draft.approved, enabled: draft.enabled, notifications: draft.notifications, intervalMinutes: draft.interval, targetKey: draft.targetKey })}>{t('保存邮件设置')}</button>
            <button className={button} disabled={locked || dirty || !data.analysisApproved} onClick={() => void command('sync')}>{data.running ? t('正在同步…') : data.morePending ? t('继续同步') : t('立即同步')}</button>
            {(data.running || data.enabled) && <button className={button} disabled={busy} onClick={() => void command('pause')}>{t('暂停同步')}</button>}
          </div>
          <p className="muted text-xs">{t('完全退出应用或电脑休眠时暂停检查，下次启动补扫。关闭窗口目前会退出应用。每批最多分析 20 封，积压时继续分批处理。')}</p>
          <p className="muted text-sm">{t('累计分析 {n} 封', { n: data.totalAnalyzed })}{data.lastSuccessAt && ' · ' + new Date(data.lastSuccessAt).toLocaleString()}</p>
          {data.lastError && <p role="alert" className="text-sm text-red-500">{describeError(data.lastError)}</p>}
          {!confirmDisconnect ? <button className={button} disabled={busy} onClick={() => setConfirmDisconnect(true)}>{t('断开并清除本机邮件数据')}</button> : <div className="space-y-2">
            <p className="text-sm">{t('将停止同步并删除本机 Gmail 凭据、摘要和扫描记录；已经创建的待办会保留。也可在 Google 账户中撤销应用授权。')}</p>
            <button className={button} disabled={busy} onClick={() => { void command('disconnect'); setConfirmDisconnect(false); }}>{t('确认断开')}</button>{' '}
            <button className={button} disabled={busy} onClick={() => setConfirmDisconnect(false)}>{t('取消')}</button>
          </div>}
        </section>
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('邮件线索')}</h2><label className="text-sm flex items-center gap-2"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />{t('显示已处理和已忽略')}</label></div>
          <p className="muted text-xs">{t('AI 判断可能遗漏或出错，截止日期和付款状态请核对原邮件。')}</p>
          {!findings.length && <div className={surface}>{t('暂无待处理的邮件线索。')}</div>}
          {findings.map(item => <article key={item.id} className={surface} style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs text-brand-500">{item.importance === 'urgent' ? t('优先核实') : t('待确认')}{item.dueDate ? ' · ' + item.dueDate : ''}</p>
            <h3 className="font-semibold break-words">{item.summary}</h3><p className="text-sm break-words">{item.action}</p>
            <details className="text-sm"><summary className="cursor-pointer">{t('邮件依据与出处')}</summary><blockquote className="border-l-2 pl-3 my-2 whitespace-pre-wrap break-words">{item.evidence}</blockquote><p className="muted break-all">{item.subject}<br />{item.from}<br />{item.date}</p>
              {item.bodyTruncated && <p className="muted">{t('正文已截断，请核对原邮件。')}</p>}
              {!!item.attachments?.length && <p className="muted break-all">{t('附件未读取：')}{item.attachments.join(', ')}</p>}
            </details>
            <div className="flex flex-wrap gap-2 text-sm">
              {item.sourceUrl?.startsWith('https://mail.google.com/mail/?') && <a className={button} href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{t('查看原邮件')}</a>}
              {item.taskId ? <Link className={button} href={'/tasks/' + item.taskId}>{t('查看待办')}</Link> : <button className={button} disabled={locked} onClick={() => void command('task', { id: item.id })}>{t('转为待办')}</button>}
              <button className={button} disabled={locked} onClick={() => void command('mark', { id: item.id, status: 'done' })}>{t('已处理')}</button>
              <button className={button} disabled={locked} onClick={() => void command('mark', { id: item.id, status: item.status === 'ignored' ? 'review' : 'ignored' })}>{item.status === 'ignored' ? t('恢复') : t('忽略')}</button>
            </div>
          </article>)}
        </section>
      </>}
    </>}
  </div>;
}
