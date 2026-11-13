window.__ModuleLoader__.load({id:'dsh-sidebar-replacement-probe',factory(require){
const module={exports:{}};const exports=module.exports;const React=require('react');
function Sidebar({collapsed,drawer,renderSlot,usePanelInfo,layout,registry}) {
 const active=usePanelInfo(s=>s.activePanelId);
 const entries=React.useSyncExternalStore(cb=>registry.subscribe('sidebar.panellist',cb),()=>registry.entries('sidebar.panellist'));
 const h=React.createElement;
 if(collapsed) return h('button',{onClick:()=>layout.toggleSidebar(),'aria-label':'打开侧边栏'},'☰');
 return h('div',{style:{display:'flex',flexDirection:'column',height:'100%',background:'#fff',color:'#222',padding:'12px',boxSizing:'border-box',overflow:'auto'}},
 h('strong',null,'秘书界面 · 替换试验'),h('button',{onClick:()=>layout.toggleSidebar()},'收起'),
 h('button',{onClick:()=>layout.selectPanel(null),'aria-current':active==null?'page':undefined},'对话'),
 ...entries.map(e=>h('button',{key:e.options.id,onClick:()=>layout.selectPanel(e.options.id)},typeof e.options.label==='string'?e.options.label:e.options.id)),
 h('div',{style:{flex:'1',overflow:'auto'}},renderSlot('sidebar.workspaces',{wide:true,expandSidebar:()=>{}})),renderSlot('sidebar.settings',{wide:true}));
}
const children={}; for(const name of ['sidebar.brand.mark','sidebar.brand.name','sidebar.toggle.badge','sidebar.workspaces','sidebar.settings']) children[name]={kind:'single',scope:'root'};
for(const name of ['sidebar.panellist','sidebar.panellist.actions','sidebar.footer.action']) children[name]={kind:'list',scope:'root'};
exports.inject=['slots','layout'];exports.apply=ctx=>ctx.slots.inject('sidebar',()=>ctx.slots.register({name:'sidebar',priority:-1,inject:()=>({layout:ctx.layout,registry:ctx.slots})},Sidebar));
return module.exports;}});
