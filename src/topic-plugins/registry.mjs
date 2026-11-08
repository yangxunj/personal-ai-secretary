import { hkWeekendPlugin } from './hk-weekend/index.mjs';

/** Explicit built-in registry: installed code is reviewed and bundled at build time. */
export function validateTopicPlugins(plugins) {
  const ids = new Set(), paths = new Set();
  for (const plugin of plugins) {
    if (!/^[a-z][a-z0-9-]{1,49}$/.test(plugin.id) || !/^\/topics\/[a-z][a-z0-9-]{1,49}$/.test(plugin.path)
      || !plugin.title || !Array.isArray(plugin.capabilities) || !Array.isArray(plugin.sourceFiles) || typeof plugin.mount !== 'function') throw new Error('Invalid topic plugin');
    if (ids.has(plugin.id) || paths.has(plugin.path)) throw new Error('Duplicate topic plugin');
    ids.add(plugin.id); paths.add(plugin.path);
  }
  return plugins;
}
export const topicPlugins = Object.freeze(validateTopicPlugins([hkWeekendPlugin]));
