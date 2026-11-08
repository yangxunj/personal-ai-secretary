import test from 'node:test';
import assert from 'node:assert/strict';
import { topicPlugins, validateTopicPlugins } from '../src/topic-plugins/registry.mjs';
import { mountTopicPlugins } from '../experiments/android-shared/web/topic-plugin-adapters.mjs';

test('registry validates identity, routes and duplicate plugin definitions', () => {
  const plugin = topicPlugins.find(item => item.id === 'hk-weekend');
  assert.equal(plugin.path, '/topics/weekend');
  assert.ok(plugin.sourceFiles.includes('PLUGIN.md')); assert.ok(plugin.sourceFiles.includes('android/WeekendNativePlugin.java'));
  assert.deepEqual(validateTopicPlugins([]), []);
  assert.throws(() => validateTopicPlugins([plugin, plugin]), /Duplicate/);
  assert.throws(() => validateTopicPlugins([{ ...plugin, path: '/tasks' }]), /Invalid/);
  assert.throws(() => validateTopicPlugins([{ ...plugin, id: '../unsafe' }]), /Invalid/);
});

test('host supplies declared capabilities and routes callbacks only to the matching plugin', () => {
  const seen = [], host = {}, parent = {}, document = {};
  const make = id => ({ id, path: `/topics/${id}`, title: id, sourceFiles: [], capabilities: ['readCache'], mount(context) { seen.push([id, context.services.readCache(), context.parent]); } });
  const plugins = validateTopicPlugins([make('plugin-a'), make('plugin-b')]);
  const factories = Object.fromEntries(plugins.map(plugin => [plugin.id, (_host, register) => {
    register((request, data) => seen.push([plugin.id, request, data]));
    return { readCache: () => plugin.id };
  }]));
  mountTopicPlugins(plugins, { host, parent, document }, factories);
  host.SecretaryTopics.receive('plugin-a', 'request-1', 'result');
  host.SecretaryTopics.receive('unregistered', 'request-2', 'ignored');
  assert.deepEqual(seen, [['plugin-a', 'plugin-a', parent], ['plugin-b', 'plugin-b', parent], ['plugin-a', 'request-1', 'result']]);
  assert.throws(() => mountTopicPlugins([plugins[0]], { host: {}, parent, document }, {}), /Missing Android adapter/);
  assert.throws(() => mountTopicPlugins([plugins[0]], { host: {}, parent, document }, { 'plugin-a': () => ({}) }), /Missing plugin capability/);
});
