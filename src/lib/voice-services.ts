/** VoiceConversation's platform boundary. Audio and credentials stay with the adapter. */
export type VoiceServices = {
  transcribe(audio: ArrayBuffer, signal: AbortSignal): Promise<string | null>;
  synthesize(text: string, signal: AbortSignal): Promise<ArrayBuffer>;
};

/** Existing web/desktop same-origin routes; Android can supply its own adapter. */
export function webVoiceServices(t: (message: string) => string): VoiceServices {
  return {
    async transcribe(audio, signal) {
      const response = await fetch('/api/asr', {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio,
        signal: AbortSignal.any([signal, AbortSignal.timeout(55_000)]),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 422) return null;
      if (!response.ok || typeof data?.text !== 'string') {
        throw new Error(!response.ok && typeof data?.error === 'string' ? data.error : t('语音识别失败，请重试'));
      }
      return data.text.trim() || null;
    },
    async synthesize(text, signal) {
      const response = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(70_000)]),
      });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) {
        const problem = await response.json().catch(() => null);
        throw new Error(typeof problem?.error === 'string' ? problem.error : t('语音合成失败，请重试'));
      }
      const audio = await response.arrayBuffer();
      if (!audio.byteLength || audio.byteLength > 20 * 1024 * 1024) throw new Error(t('语音合成失败，请重试'));
      return audio;
    },
  };
}
