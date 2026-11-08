import { attachWeekendPanel } from './panel.mjs';
const ROUTE = '/topics/weekend';

/** Built-in, reviewed topic extension. The host owns navigation and capabilities. */
export const hkWeekendPlugin = Object.freeze({
  id: 'hk-weekend', path: ROUTE, title: '周末去哪',
  summary: '查询香港适合家庭出行的活动。', category: '出行',
  capabilities: ['fetchSource', 'readCache', 'saveCache', 'openLink', 'hasModelKey', 'hasModel', 'requestModel'],
  styleFile: 'src/topic-plugins/hk-weekend/styles.css',
  sourceFiles: ['PLUGIN.md', 'index.mjs', 'panel.mjs', 'engine.mjs', 'service.mjs', 'recommend.mjs', 'android-adapter.mjs', 'styles.css', 'android/WeekendClient.java', 'android/WeekendNativePlugin.java'],
  mount({ document, parent, services }) {
    const element = (tag, attributes = {}, text) => {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const root = element('section', { class: 'pilot-weekend', 'data-screen': ROUTE, 'aria-labelledby': 'weekend-title', hidden: '' });
    root.append(
      element('button', { class: 'secondary', type: 'button', 'data-open-screen': '/topics' }, '← 返回专题'),
      element('h2', { id: 'weekend-title' }, '周末去哪'),
      element('p', {}, '查询香港官方活动资料；亲子分类仅供参考，活动日期、适龄、票价和预约安排请以主办方最新说明为准。当前未按位置筛选。'),
      element('label', { for: 'weekend-preference' }, '出行偏好（可选）'),
      element('textarea', { id: 'weekend-preference', rows: '2', maxlength: '300', placeholder: '例如：希望靠近地铁、适合儿童' }),
      element('p', {}, '查询并推荐会将活动摘要和填写的偏好发送给 DeepSeek；活动较多时可能调用多次并产生 API 费用。'),
      element('button', { type: 'button', id: 'weekend-refresh' }, '查询并 AI 推荐'),
      element('button', { class: 'secondary', type: 'button', id: 'weekend-recommend', disabled: '' }, '重新生成推荐'),
      element('p', { id: 'weekend-status', role: 'status', 'aria-live': 'polite' }),
      element('p', { id: 'weekend-ai-status', role: 'status', 'aria-live': 'polite' }),
      element('div', { id: 'weekend-source-links' }),
      element('div', { id: 'weekend-recommendations' }),
      element('div', { id: 'weekend-results' }),
    );
    parent.append(root);
    attachWeekendPanel(document, root, services);
    return root;
  },
});
