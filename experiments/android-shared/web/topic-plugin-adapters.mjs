import { createAndroidWeekendServices } from '../../../src/topic-plugins/hk-weekend/android-adapter.mjs';

// This is the platform composition root. New reviewed plugins register their
// own platform adapter here; application navigation does not know their logic.
const factories = { 'hk-weekend': createAndroidWeekendServices };
export function mountTopicPlugins(plugins, { document, host, parent }, adapterFactories = factories) {
  const receivers = new Map();
  host.SecretaryTopics = { receive(pluginId, requestId, raw) { receivers.get(pluginId)?.(requestId, raw); } };
  for (const plugin of plugins) {
    const factory = adapterFactories[plugin.id];
    if (!factory) throw new Error(`Missing Android adapter for topic plugin: ${plugin.id}`);
    const services = factory(host, receiver => { receivers.set(plugin.id, receiver); });
    for (const capability of plugin.capabilities) if (typeof services[capability] !== 'function') throw new Error(`Missing plugin capability: ${capability}`);
    plugin.mount({ document, parent, services });
  }
}
