/** One native foreground microphone session; raw audio is never written to storage. */
export function createNativeMicrophone(host, bridge) {
  let current;
  host.SecretaryMicrophone = {
    receive(id, type, payload) {
      const session = current;
      if (!session || session.id !== id) return;
      if (type === 'ready') { session.ready(payload); return; }
      if (type === 'error') { session.fail(); return; }
      if (type !== 'audio') return;
      try {
        if (!session.started || !session.listening) return;
        const binary = host.atob(payload);
        if (!binary.length || binary.length > 3200 || binary.length % 2) throw new Error('Invalid PCM');
        const frame = new Float32Array(binary.length / 2);
        for (let i = 0; i < frame.length; i++) {
          let sample = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8;
          if (sample >= 32768) sample -= 65536;
          frame[i] = sample / 32768;
        }
        session.onFrame(frame);
      } catch { session.fail(); }
      finally { bridge.acknowledgeNativeMicrophone(id); }
    },
  };
  return {
    start(signal, onFrame, onError) {
      signal.throwIfAborted();
      if (current) return Promise.reject(new Error('Native microphone busy'));
      return new Promise((resolve, reject) => {
        const id = 'mic-' + Array.from(host.crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
        let done = false;
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); if (current === session) current = undefined; };
        const stop = () => {
          if (current !== session) return;
          bridge.stopNativeMicrophone(id); cleanup();
          if (!done) { done = true; reject(new DOMException('Cancelled', 'AbortError')); }
        };
        const fail = () => {
          const started = session.started;
          bridge.stopNativeMicrophone(id); cleanup();
          if (!done) { done = true; reject(new DOMException('Native capture failed', 'NativeCaptureError')); }
          else if (started) onError();
        };
        const timer = setTimeout(fail, 10000);
        const session = current = { id, started: false, listening: false, onFrame, fail,
          ready(rate) {
            if (done || rate !== '16000') { if (!done) fail(); return; }
            done = true; session.started = true; clearTimeout(timer);
            resolve({ sampleRate: 16000, stop, setListening(value) {
              if (current !== session) return;
              session.listening = value; bridge.setNativeMicrophoneListening(id, value);
            } });
          },
        };
        signal.addEventListener('abort', stop, { once: true });
        try { bridge.startNativeMicrophone(id); } catch { fail(); }
      });
    },
  };
}
