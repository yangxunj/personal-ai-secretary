/** Capture microphone samples for the shared voice detector without audible loopback. */
export async function createVoiceCapture(audio: AudioContext, stream: MediaStream, workletUrl: string,
  onFrame: (frame: Float32Array) => void, onError: () => void) {
  const input = audio.createMediaStreamSource(stream);
  let worklet: AudioWorkletNode | null = null;
  let fallback: ScriptProcessorNode | null = null;
  try {
    if (audio.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            audio.audioWorklet.addModule(workletUrl),
            new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Worklet timeout')), 4000); }),
          ]);
        } finally { if (timeout) clearTimeout(timeout); }
        if (audio.state === 'closed') throw new Error('Audio context closed');
        worklet = new AudioWorkletNode(audio, 'voice-capture', { outputChannelCount: [1] });
        worklet.onprocessorerror = onError;
        worklet.port.onmessage = (event: MessageEvent<Float32Array>) => onFrame(event.data);
      } catch (error) {
        if (audio.state === 'closed') throw error;
        worklet?.disconnect(); worklet = null;
      }
    }
    if (!worklet) {
      if (typeof audio.createScriptProcessor !== 'function') throw new Error('Audio capture unavailable');
      // Some Android WebViews cannot load worklet modules through the local asset origin.
      // Copy each input frame because the browser may reuse its buffer after the callback.
      fallback = audio.createScriptProcessor(1024, 1, 1);
      fallback.onaudioprocess = event => {
        for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel++) event.outputBuffer.getChannelData(channel).fill(0);
        if (event.inputBuffer.numberOfChannels) onFrame(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
    }
    const node = worklet ?? fallback!;
    input.connect(node); node.connect(audio.destination);
    return () => {
      if (worklet) { worklet.port.onmessage = null; worklet.onprocessorerror = null; worklet.disconnect(); }
      if (fallback) { fallback.onaudioprocess = null; fallback.disconnect(); }
      input.disconnect();
    };
  } catch (error) {
    if (worklet) { worklet.port.onmessage = null; worklet.onprocessorerror = null; worklet.disconnect(); }
    if (fallback) { fallback.onaudioprocess = null; fallback.disconnect(); }
    input.disconnect();
    throw error;
  }
}
