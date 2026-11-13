import React, { useEffect, useState } from 'react';
import SideNavView from '../../../src/components/navigation/shared/SideNavView';
import SlideViewer from '../../../src/components/slides/SlideViewer';

declare const __SLIDE_STYLES__: { theme: string; adaptive: string };
const slideStyles = __SLIDE_STYLES__;
type Deck = { id: string; title: string; markdown: string };
type Row = { id: string; title: string };
type Connection = { rpc: { call: (channel: string, endpoint: string, payload: unknown) => Promise<any> } };
const PILOT = 'secretary-shell-pilot';
const SLIDES = 'secretary-slides-pilot';
const styles = `
.secretary-pilot { --bg:#f6f7f9;--surface:#fff;--text:#232934;--muted:#767e8f;--border:#e6e9ef;--color-brand-500:#4f6ef7;display:flex;height:100%;min-height:0;background:var(--bg);color:var(--text);font:14px system-ui,sans-serif }
.secretary-pilot .shared-side-nav { display:flex!important;position:relative!important;inset:auto!important;z-index:auto!important;flex:0 0 224px;width:224px;height:100%;flex-direction:column;background:var(--surface);border-right:1px solid var(--border) }
.secretary-pilot .shared-side-nav>div:first-child { padding:0 20px;min-height:56px;display:flex;align-items:center;font-size:16px }
.secretary-pilot .shared-side-nav>div:nth-child(2) { flex:1;overflow:auto;padding:0 8px }
.secretary-pilot .shared-side-nav button { display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border:0;border-radius:12px;background:transparent;text-align:left;color:var(--muted);cursor:pointer }
.secretary-pilot .shared-side-nav button[aria-current=page] { color:var(--color-brand-500)!important;background:#4f6ef715 }
.secretary-pilot .shared-side-nav button:disabled { opacity:.48;cursor:default }
.secretary-pilot .shared-side-nav svg { flex:0 0 20px;width:20px;height:20px }
.secretary-pilot .pilot-content { flex:1;min-width:0;overflow:auto;padding:28px clamp(20px,5vw,56px) }
.secretary-pilot .pilot-content h1 { margin:0 0 8px;font-size:24px;font-weight:650 }
.secretary-pilot .pilot-content p { color:var(--muted);line-height:1.6 }
.secretary-pilot .pilot-button,.secretary-pilot .pilot-row,.secretary-pilot .slides-controls button { border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);padding:9px 14px;cursor:pointer }
.secretary-pilot .pilot-row { display:block;width:100%;margin:12px 0;text-align:left;padding:16px }
.secretary-pilot .slides-controls { display:flex;justify-content:center;align-items:center;gap:20px;margin:16px 0 }
.secretary-pilot button:disabled { opacity:.45;cursor:default }
.secretary-pilot .pilot-note { padding:10px 14px;background:#edf1ff;border-radius:10px }
@media(max-width:700px) {.secretary-pilot .shared-side-nav {flex-basis:150px;width:150px}.secretary-pilot .pilot-content{padding:20px 12px}}
`;
function Icon({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>; }

function useDecks(connection: Connection) {
  const [rows, setRows] = useState<Row[]>([]), [deck, setDeck] = useState<Deck | null>(null), [status, setStatus] = useState('正在读取…');
  const call = async (endpoint: string, payload: object) => { const result = await connection.rpc.call('/api', 'secretary-slides/' + endpoint, payload); if (!result.ok) throw new Error(result.error?.message || '读取失败'); return result.value; };
  const refresh = async () => { try { setStatus('正在读取…'); const value = await call('list', {}); setRows(value); setStatus(value.length ? '' : '还没有幻灯片，请在对话中让 AI 创建。'); } catch { setStatus('读取失败，请检查插件是否启用后重试。'); } };
  useEffect(() => { void refresh(); }, []);
  const open = async (id: string) => { try { const value = await call('read', { id }); if (!value) throw new Error('missing'); setDeck(value); setStatus(''); } catch { setStatus('无法打开幻灯片，请刷新后重试。'); } };
  return { rows, deck, setDeck, status, refresh, open };
}
function DeckContent({ connection }: { connection: Connection }) {
  const { rows, deck, setDeck, status, refresh, open } = useDecks(connection);
  return <><h1>知识幻灯片</h1><p>查看通过对话创建的幻灯片。</p>{status && <p role="status">{status}</p>}
    {deck ? <><button className="pilot-button" onClick={() => { setDeck(null); void refresh(); }}>返回列表</button><SlideViewer key={deck.id} title={deck.title} markdown={deck.markdown} inlineStyles={slideStyles}/></>
      : <><button className="pilot-button" onClick={() => void refresh()}>刷新列表</button>{rows.map(row => <button className="pilot-row" key={row.id} onClick={() => void open(row.id)}>{row.title}</button>)}</>}
  </>;
}
function SecretaryPanel({ connection, layout }: { connection: Connection; layout: any }) {
  return <div className="secretary-pilot"><style>{styles}</style>
    <SideNavView pathname="/slides" t={(text: string) => text}
      renderItem={({ href, label, className, style, children }: any) => <button key={href} type="button" className={className} style={style} disabled={href !== '/chat'} title={href === '/chat' ? '返回 DSH 对话' : '此栏目尚未接入试验'} onClick={() => layout.selectPanel(null)} aria-label={label}>{children}</button>}
      collections={<button type="button" aria-current="page">知识幻灯片</button>}
      trailing={<div style={{ padding:'12px', color:'var(--muted)', borderTop:'1px solid var(--border)' }}>秘书界面试验</div>}/>
    <div className="pilot-content"><p className="pilot-note">界面复用试验：可查看幻灯片；其他栏目尚未接入。点击“对话”返回 DSH。</p><DeckContent connection={connection}/></div>
  </div>;
}
function LegacyPanel({ connection }: { connection: Connection }) {
  return <div className="secretary-pilot"><style>{styles}</style><div className="pilot-content"><DeckContent connection={connection}/></div></div>;
}
export const inject = ['slots', 'connection', 'layout'];
export function apply(ctx: any) {
  ctx.slots.inject('main', () => ctx.slots.register({ name:'main', key:SLIDES, inject:() => ({ connection:ctx.connection }) }, LegacyPanel));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id:SLIDES, order:20, label:'知识幻灯片' }, Icon));
  ctx.slots.inject('main', () => ctx.slots.register({ name:'main', key:PILOT, inject:() => ({ connection:ctx.connection, layout:ctx.layout }) }, SecretaryPanel));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id:PILOT, order:21, label:'秘书界面试验' }, Icon));
}
