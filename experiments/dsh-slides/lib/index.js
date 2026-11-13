import { createStore } from './store.js';
import { listView, deckView, splitPages } from './views.js';

export const name = 'secretary-slides-pilot';
export const inject = ['tools'];
export function apply(ctx, options = {}) {
  const store = createStore(options.directory), selection = new Map();
  const scopeKey = scope => scope?.sessionId || 'features';
  const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
  const register = (name, description, fields, execute) => {
    const properties = Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, { type: spec.type, description: spec.description }]));
    const required = Object.entries(fields).filter(([, spec]) => spec.required).map(([key]) => key);
    return ctx.tools.register({
      name, description, parameters: { type: 'object', properties, required, additionalProperties: false },
      output, isConcurrencySafe: () => false,
      execute(args) {
        if (!args || typeof args !== 'object' || Array.isArray(args) ||
            Object.keys(args).some(key => !Object.hasOwn(properties, key)) ||
            Object.entries(args).some(([key, value]) => typeof value !== properties[key].type) ||
            required.some(key => !Object.hasOwn(args, key))) throw new Error('幻灯片工具参数无效');
        return execute(args);
      },
    });
  };
  register('secretary_create_slides', 'Create a knowledge slide deck only when the user asks for one. Write concise text-only Marp Markdown; separate slides with a line containing ---; do not include HTML, images or external resources. Save once, then tell the user to open 知识幻灯片 from the desktop sidebar or the DSH Go plugin panel. Only claim success when the tool succeeds.',
    { title: { type: 'string', required: true, description: 'Title, 1–100 characters.' }, markdown: { type: 'string', required: true, description: 'Complete slide Markdown, 1–12000 characters.' } },
    args => { const deck = store.create(args); try { ctx.dshGo?.refresh('slides'); } catch {} return JSON.stringify({ ok: true, id: deck.id, title: deck.title, pages: splitPages(deck.markdown).length }); });
  register('secretary_list_slides', 'List saved knowledge slide decks from this pilot, newest first.', {},
    () => JSON.stringify({ ok: true, decks: store.list().slice(0, 50).map(({ id, title, createdAt }) => ({ id, title, createdAt })) }));
  register('secretary_read_slides', 'Read a saved knowledge slide deck by its ID from secretary_list_slides.',
    { id: { type: 'string', required: true, description: 'Deck ID.' } },
    args => JSON.stringify({ ok: true, deck: store.read(args.id) }));
  ctx.inject(['connection'], scoped => {
    for (const action of ['list', 'read']) scoped.connection.fetch.register({
      path: '/api/secretary-slides/' + action, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        let message;
        try { message = await request.json(); } catch { return new Response('invalid request', { status: 400 }); }
        if (message?.type !== 'client-request' || typeof message.rpcId !== 'string' || message.rpcId.length > 100 || message.method !== 'secretary-slides/' + action)
          return new Response('invalid request', { status: 400 });
        let result;
        try {
          const value = action === 'list' ? store.list().slice(0, 50).map(({ id, title, createdAt }) => ({ id, title, createdAt })) : store.read(message.payload?.id);
          result = { ok: true, value };
        } catch { result = { ok: false, error: { code: 'storage', message: '无法读取幻灯片', details: {} } }; }
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
      },
    });
  });
  ctx.inject(['dshGo'], scoped => {
    scoped.dshGo.panel('slides', {
      view(scope) {
        const state = selection.get(scopeKey(scope));
        if (!state) return listView(store.list());
        const deck = store.read(state.id);
        return deck ? deckView(deck, state.page) : listView(store.list());
      },
      actions: {
        open(scope, event) {
          const id = event?.value?.id;
          if (!store.read(id)) return { toast: '幻灯片不存在' };
          selection.set(scopeKey(scope), { id, page: 0 }); return { refresh: true };
        },
        list(scope) { selection.delete(scopeKey(scope)); return { refresh: true }; },
        previous(scope) { const state = selection.get(scopeKey(scope)); if (state) state.page = Math.max(0, state.page - 1); return { refresh: true }; },
        next(scope) { const state = selection.get(scopeKey(scope)); if (state) state.page++; return { refresh: true }; },
      },
    });
  });
}
