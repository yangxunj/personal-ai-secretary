import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !context.parentURL.includes('/node_modules/')) {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      const file = ['.ts', '.tsx'].map(extension => base + extension).find(existsSync);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && /\.tsx?$/.test(url) && !url.includes('/node_modules/')) return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { fileName: fileURLToPath(url), compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
test.after(() => hooks.deregister());
const { groupConversationItems } = await import('../../src/components/chat/shared/conversation-list.ts');
const { default: ConversationListView } = await import('../../src/components/chat/shared/ConversationListView.tsx');
const { default: TaskCard } = await import('../../src/components/tasks/shared/TaskCard.tsx');
const { default: TaskStatusSelect } = await import('../../src/components/tasks/shared/TaskStatusSelect.tsx');
const { default: TaskOwnerSelect } = await import('../../src/components/tasks/shared/TaskOwnerSelect.tsx');
const { default: BottomNavView } = await import('../../src/components/navigation/shared/BottomNavView.tsx');
const { scopedTaskUpdate, scopedTaskUpdateWithId } = await import('../../src/lib/tasks/scoped-contract.ts');
const now = new Date(2026, 10, 4, 12), t = value => value;

test('web and Android task chats share field rules while binding the task ID differently', () => {
  const patch = { status: 'doing', title: '  Follow up  ', dueDate: '', owner: '' };
  assert.deepEqual(scopedTaskUpdate.parse(patch), { ...patch, title: 'Follow up' });
  assert.deepEqual(scopedTaskUpdateWithId.parse({ ...patch, id: 'task-1' }), { ...patch, title: 'Follow up', id: 'task-1' });
  for (const bad of [{ detail: 'overwrite' }, { status: 'invalid' }, { priority: 4 }]) {
    assert.equal(scopedTaskUpdate.safeParse(bad).success, false);
    assert.equal(scopedTaskUpdateWithId.safeParse({ id: 'task-1', ...bad }).success, false);
  }
  assert.equal(scopedTaskUpdate.safeParse({ id: 'other' }).success, false);
  assert.equal(scopedTaskUpdateWithId.safeParse({}).success, false);
});

test('shared conversation date buckets preserve incoming order and existing local-day semantics', () => {
  const rows = [0, 1, 4, 15, 40].map((days, index) => ({ id: String(index), title: 'row-' + index, updatedAt: new Date(2026, 10, 4 - days, 10).toISOString() }));
  const groups = groupConversationItems(rows, t, now);
  assert.deepEqual(groups.map(([label]) => label), ['今天', '昨天', '7 天内', '30 天内', '更早']);
  assert.deepEqual(groups.flatMap(([, values]) => values.map(row => row.id)), rows.map(row => row.id));
  assert.deepEqual(groupConversationItems([], t, now), []);
});

test('one conversation view supports disabled native buttons and caller-owned web navigation without injecting titles', () => {
  const items = [{ id: 'a', title: '<script>title</script>', updatedAt: now.toISOString(), provisional: false }];
  const native = renderToStaticMarkup(createElement(ConversationListView, { items, activeId: 'a', t, disabled: true }));
  assert.equal((native.match(/disabled=""/g) || []).length, 2);
  assert.match(native, /aria-current="page"/); assert.doesNotMatch(native, /<script>/);
  const web = renderToStaticMarkup(createElement(ConversationListView, { items, activeId: 'a', t,
    renderNavigation: ({ id, className, children }) => createElement('a', { href: id === null ? '/chat' : '/chat/' + id, className }, children) }));
  assert.match(web, /href="\/chat"/); assert.match(web, /href="\/chat\/a"/);
  assert.doesNotMatch(web, /<button/);
  const removable = renderToStaticMarkup(createElement(ConversationListView, { items, activeId: 'a', t, onDelete() {} }));
  assert.match(removable, /aria-label="删除对话：&lt;script&gt;title&lt;\/script&gt;"/);
  assert.equal((removable.match(/<button/g) || []).length, 3);
});

test('all shared conversation and text input source files match the Android build manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('web-dist/build-manifest.json', import.meta.url), 'utf8'));
  for (const file of ['src/components/chat/shared/ConversationListView.tsx', 'src/components/chat/shared/ChatTextInput.tsx', 'src/components/chat/shared/conversation-list.ts']) {
    const entry = manifest.sharedUiSources.find(entry => entry.file === file);
    assert.ok(entry, file);
    assert.equal(entry.sha256, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'));
  }
});

test('Android bundle records the same shell, navigation, header and chat bubble sources as the web', () => {
  const manifest = JSON.parse(readFileSync(new URL('web-dist/build-manifest.json', import.meta.url), 'utf8'));
  for (const file of [
    'src/components/navigation/shared/AppShell.tsx',
    'src/components/navigation/shared/SideNavView.tsx',
    'src/components/navigation/shared/BottomNavView.tsx',
    'src/components/navigation/shared/PageHeaderView.tsx',
    'src/components/navigation/shared/MoreNavigationView.tsx',
    'src/components/chat/shared/ChatBubble.tsx',
    'src/components/chat/shared/ConversationDrawer.tsx',
  ]) {
    const entry = manifest.sharedUiSources.find(row => row.file === file);
    assert.ok(entry, file);
    assert.equal(entry.sha256, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'));
  }
  assert.equal(manifest.surfaceThemeSha256, createHash('sha256').update(readFileSync(path.join(root, 'src/styles/surface-theme.css'))).digest('hex'));
});

test('shared task card keeps platform navigation and actions, escapes titles and shows high priority', () => {
  const markup = renderToStaticMarkup(createElement(TaskCard, { title: '<script>unsafe</script>', completed: false,
    highPriority: true, highPriorityLabel: '高优先级', active: true,
    navigation: createElement('a', { href: '/tasks/test' }, 'open'),
  }, createElement('button', { type: 'button' }, 'done')));
  assert.doesNotMatch(markup, /<script>/); assert.match(markup, /&lt;script&gt;unsafe/);
  assert.match(markup, /href="\/tasks\/test"/); assert.match(markup, /<button/);
  assert.match(markup, /aria-label="高优先级"/); assert.match(markup, /ring-2/);
  const manifest = JSON.parse(readFileSync(new URL('web-dist/build-manifest.json', import.meta.url), 'utf8'));
  const file = 'src/components/tasks/shared/TaskCard.tsx';
  const entry = manifest.sharedUiSources.find(row => row.file === file);
  assert.ok(entry); assert.equal(entry.sha256, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'));
});

test('shared task controls retain uncommon status and existing owner, and honor pending state', () => {
  const status = renderToStaticMarkup(createElement(TaskStatusSelect, { status: 'blocked', disabled: true, t, onChange() {} }));
  assert.match(status, /disabled=""/); assert.match(status, /value="blocked" selected/);
  assert.match(status, /value="done"/); assert.match(status, /value="todo"/);
  const owner = renderToStaticMarkup(createElement(TaskOwnerSelect, { owner: 'Old member', members: ['Alice'], t, onChange() {} }));
  assert.match(owner, /value="Old member" selected/); assert.match(owner, /value="Alice"/); assert.match(owner, /value=""/);
  const manifest = JSON.parse(readFileSync(new URL('web-dist/build-manifest.json', import.meta.url), 'utf8'));
  for (const file of ['src/components/tasks/shared/TaskStatusSelect.tsx', 'src/components/tasks/shared/TaskOwnerSelect.tsx']) {
    const entry = manifest.sharedUiSources.find(row => row.file === file);
    assert.ok(entry); assert.equal(entry.sha256, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'));
  }
});

test('shared bottom navigation keeps web links and lets Android disable unsupported screens', () => {
  const web = renderToStaticMarkup(createElement(BottomNavView, { pathname: '/tasks/123', badge: 3, t,
    renderItem: ({ href, className, style, children }) => createElement('a', { key: href, href, className, style }, children) }));
  for (const href of ['/chat', '/tasks', '/vault', '/finance', '/health', '/topics', '/more']) assert.ok(web.includes(`href="${href}"`));
  assert.match(web, />3<\/span>/);
  const android = renderToStaticMarkup(createElement(BottomNavView, { pathname: '/collections', t,
    renderItem: ({ href, active, children }) => createElement('button', { key: href, disabled: !['/chat','/tasks','/more'].includes(href), 'aria-current': active ? 'page' : undefined }, children) }));
  assert.equal((android.match(/disabled=""/g) || []).length, 4);
  assert.equal((android.match(/aria-current="page"/g) || []).length, 1);
  const manifest = JSON.parse(readFileSync(new URL('web-dist/build-manifest.json', import.meta.url), 'utf8'));
  for (const file of ['src/components/navigation/shared/BottomNavView.tsx', 'src/components/nav-tabs.tsx']) {
    const entry = manifest.sharedUiSources.find(row => row.file === file);
    assert.ok(entry); assert.equal(entry.sha256, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex'));
  }
});
