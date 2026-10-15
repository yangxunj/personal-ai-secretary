/** 浏览器与服务端共同约定：16kHz、单声道、16-bit PCM WAV，最多一分钟。 */
export const VOICE_SAMPLE_RATE = 16000;
export const VOICE_MAX_SECONDS = 60;
export const VOICE_MAX_BYTES = 44 + VOICE_SAMPLE_RATE * VOICE_MAX_SECONDS * 2;

export function encodeVoiceWav(samples: Float32Array): ArrayBuffer {
  const length = Math.min(samples.length, VOICE_SAMPLE_RATE * VOICE_MAX_SECONDS);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  tag(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, VOICE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

/** 只接收我们自己的固定 WAV 格式；不能只相信 MIME 或客户端报的时长。 */
export function validVoiceWav(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 44 + VOICE_SAMPLE_RATE / 4 * 2 || buffer.byteLength > VOICE_MAX_BYTES) return false;
  const view = new DataView(buffer);
  const tag = (offset: number, text: string) => [...text].every((c, i) => view.getUint8(offset + i) === c.charCodeAt(0));
  return tag(0, 'RIFF') && tag(8, 'WAVE') && tag(12, 'fmt ') && tag(36, 'data')
    && view.getUint32(4, true) === buffer.byteLength - 8 && view.getUint32(16, true) === 16
    && view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1
    && view.getUint32(24, true) === VOICE_SAMPLE_RATE && view.getUint32(28, true) === VOICE_SAMPLE_RATE * 2
    && view.getUint16(32, true) === 2 && view.getUint16(34, true) === 16
    && view.getUint32(40, true) === buffer.byteLength - 44 && (buffer.byteLength - 44) % 2 === 0;
}
