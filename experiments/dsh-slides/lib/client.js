window.__ModuleLoader__.load({
  id: 'dsh-secretary-slides-pilot',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const PANEL = 'secretary-slides-pilot';
    function Icon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }), h('path', { d: 'M8 21h8M12 17v4' }));
    }
    function Page({ connection }) {
      const [rows, setRows] = React.useState([]), [deck, setDeck] = React.useState(null), [page, setPage] = React.useState(0), [status, setStatus] = React.useState('正在读取…');
      const call = async (endpoint, payload) => {
        const result = await connection.rpc.call('/api', 'secretary-slides/' + endpoint, payload);
        if (!result.ok) throw new Error(result.error?.message || '读取失败');
        return result.value;
      };
      const refresh = async () => { try { setStatus('正在读取…'); const result = await call('list', {}); setRows(result); setStatus(result.length ? '' : '还没有幻灯片，请在对话中让 AI 创建。'); } catch (error) { setStatus('读取失败：' + (error?.message || '请检查插件是否启用后重试。')); } };
      React.useEffect(() => { void refresh(); }, []);
      const open = async id => { try { setStatus('正在读取…'); const value = await call('read', { id }); if (!value) throw new Error('missing'); setDeck(value); setPage(0); setStatus(''); } catch { setStatus('无法打开幻灯片，请刷新后重试。'); } };
      const pages = deck ? deck.markdown.split(/^\s*---\s*$/m).map(s => s.trim()).filter(Boolean) : [];
      return h('main', { style: { padding: '28px', overflow: 'auto', height: '100%', color: 'var(--text-primary, inherit)' } },
        h('h1', null, '知识幻灯片'), h('p', null, '这里显示通过秘书幻灯片插件保存的作品。'),
        status && h('p', { role: 'status' }, status),
        !deck ? h(React.Fragment, null, h('button', { type: 'button', onClick: refresh }, '刷新列表'),
          h('ul', null, rows.map(row => h('li', { key: row.id }, h('button', { type: 'button', onClick: () => open(row.id) }, row.title)))))
          : h(React.Fragment, null, h('button', { type: 'button', onClick: () => { setDeck(null); void refresh(); } }, '返回列表'),
            h('h2', null, deck.title), h('p', null, `${page + 1} / ${pages.length}`),
            h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', lineHeight: 1.7 } }, pages[page] || ''),
            h('button', { type: 'button', disabled: page === 0, onClick: () => setPage(p => p - 1) }, '上一页'), ' ',
            h('button', { type: 'button', disabled: page >= pages.length - 1, onClick: () => setPage(p => p + 1) }, '下一页')));
    }
    function apply(ctx) {
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, inject: () => ({ connection: ctx.connection }) }, Page));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 20, label: '知识幻灯片' }, Icon));
    }
    return { inject: ['slots', 'connection'], apply };
  },
});
