/** Prefer echo cancellation; retry only when the WebView rejects the requested constraints. */
export async function openVoiceMicrophone(mediaDevices: Pick<MediaDevices, 'getUserMedia'>, isCurrent: () => boolean): Promise<MediaStream> {
  try {
    return await mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  } catch (error) {
    const name = voiceErrorCode(error);
    if (!['OverconstrainedError', 'ConstraintNotSatisfiedError', 'TypeError', 'NotSupportedError'].includes(name)) throw error;
    if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError');
    return mediaDevices.getUserMedia({ audio: true });
  }
}

/** Only return an exception class, never a provider/browser message that may contain private data. */
export function voiceErrorCode(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  return /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) ? name : 'UnknownError';
}

/** The host owns permission and audio capture; domain detection remains shared. */
export type NativeVoiceMicrophone = {
  start(signal: AbortSignal, onFrame: (frame: Float32Array) => void, onError: () => void): Promise<{
    sampleRate: number; setListening(value: boolean): void; stop(): void;
  }>;
};
