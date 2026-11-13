import React from 'react';
import SideNavView from '../../../../src/components/navigation/shared/SideNavView';

type Props = { wide: boolean; activePanelId: string | null; panels: { id: string }[]; selectPanel: (id: string | null) => void; children: React.ReactNode };
const css = `.secretary-sidebar-nav{max-height:30vh;overflow:auto;flex:none}
.secretary-sidebar-nav .shared-side-nav{display:flex!important;position:static!important;width:auto!important;flex-direction:column;border:0!important}
.secretary-sidebar-nav .shared-side-nav>div:first-child{display:none}
.secretary-sidebar-nav .shared-side-nav>div:nth-child(2){padding:4px 8px;overflow:visible;display:flex;flex-direction:column}
.secretary-sidebar-nav button{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;text-align:left;cursor:pointer;color:inherit}
.secretary-sidebar-nav button[aria-current=page]{background:#4f6ef726;color:#4f6ef7!important}
.secretary-sidebar-nav button:disabled{opacity:.45;cursor:default}
.secretary-sidebar-nav svg{width:18px;height:18px;flex:none}`;

export default function SecretaryContainer({ wide, activePanelId, panels, selectPanel, children }: Props) {
  return <>
    {wide && <div className="secretary-sidebar-nav"><style>{css}</style><SideNavView pathname={activePanelId === null ? '/chat' : '/slides'} t={text => text}
      renderItem={({ href, label, children: itemChildren, style }) => <button key={href} type="button" disabled={href !== '/chat'} aria-current={href === '/chat' && activePanelId === null ? 'page' : undefined} aria-label={label} style={style} onClick={() => selectPanel(null)} title={href === '/chat' ? '打开对话' : '尚未接入'}>{itemChildren}</button>}
      afterChat={<button type="button" disabled={!panels.some(panel => panel.id === 'secretary-slides-pilot')} aria-current={activePanelId === 'secretary-slides-pilot' ? 'page' : undefined} onClick={() => selectPanel('secretary-slides-pilot')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg><span>知识幻灯片</span></button>} /></div>}
    {children}
  </>;
}
