/** Narrow asynchronous bridge: credentials and remote URLs remain native-only. */
export function createVoiceServices(host, bridge, settingsChanged = () => {}) {
  const pending = new Map();
  const nonce = () => Array.from(host.crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  host.SecretaryVoice = {
    settingsChanged,
    receive(id, raw) {
      const request = pending.get(id);
      if (!request) return;
      try {
        const result = JSON.parse(raw);
        if (!result.ok || typeof result.data !== 'string') throw new Error(result.error || '语音服务未完成。');
        request.resolve(result.data);
      } catch (error) { request.reject(error); }
    },
  };
  function request(kind, payload, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = `voice-${nonce()}`;
      const cleanup = () => { pending.delete(id); clearTimeout(timer); signal.removeEventListener('abort', abort); };
      const abort = () => { bridge.cancelVoiceRequest(id); cleanup(); reject(new DOMException('已取消', 'AbortError')); };
      const timer = setTimeout(() => { bridge.cancelVoiceRequest(id); cleanup(); reject(new Error('语音服务超时，请重试。')); }, 70000);
      pending.set(id, { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); } });
      signal.addEventListener('abort', abort, { once: true });
      try { bridge.beginVoiceRequest(id, kind, payload); }
      catch { cleanup(); reject(new Error('语音服务不可用，请重新打开应用。')); }
    });
  }
  return {
    async transcribe(audio, signal) {
      const bytes = new Uint8Array(audio);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const text = await request('asr', host.btoa(binary), signal);
      return text.trim() || null;
    },
    async synthesize(text, signal) {
      const encoded = await request('tts', text, signal);
      const binary = host.atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    },
  };
}
