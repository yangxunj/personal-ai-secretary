/** Android-specific capability adapter for the built-in weekend topic plugin. */
export function createAndroidWeekendServices(host, registerReceiver) {
  const bridge = host.SecretaryStorage, pending = new Map(); let serial = 0;
  const pluginId = 'hk-weekend';
  const session = Array.from(host.crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('');
  registerReceiver((id, raw) => {
    const entry = pending.get(id); if (!entry) return;
    pending.delete(id); host.clearTimeout(entry.timer);
    try { const result = JSON.parse(raw); if (!result.ok || typeof result.data !== 'string') throw new Error(); entry.resolve(result.data); }
    catch { entry.reject(new Error('来源暂时不可用')); }
  });
  return {
    fetchSource(query) { return new Promise((resolve, reject) => {
      if (!bridge?.topicRequest) { reject(new Error('网络功能不可用')); return; }
      const id = `weekend-${session}-${++serial}`;
      const timer = host.setTimeout(() => { pending.delete(id); reject(new Error('请求超时')); }, 55000);
      pending.set(id, { resolve, reject, timer });
      try { bridge.topicRequest(pluginId, id, JSON.stringify(query)); }
      catch { pending.delete(id); host.clearTimeout(timer); reject(new Error('网络功能不可用')); }
    }); },
    readCache: () => bridge?.topicReadCache?.(pluginId) || '',
    saveCache: value => bridge?.topicWriteCache?.(pluginId, value) === true,
    openLink: value => bridge?.topicOpenLink?.(pluginId, value),
    hasModelKey: () => !!bridge?.hasApiKey?.(),
    hasModel: () => !!host.SecretaryAI?.request,
    requestModel: (body, signal) => host.SecretaryAI.request(body, signal),
  };
}
