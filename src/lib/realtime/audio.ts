/** 连续重采样保留跨帧位置，避免 44.1kHz 输入在每个小块边界丢样。 */
export class PcmResampler {
  private pending = new Float32Array(0);
  private position = 0;
  constructor(private from: number, private to = 16000) {}
  push(frame: Float32Array): Int16Array {
    const joined = new Float32Array(this.pending.length + frame.length);
    joined.set(this.pending); joined.set(frame, this.pending.length);
    const values: number[] = [], step = this.from / this.to;
    while (this.position + 1 < joined.length) {
      const at = Math.floor(this.position), fraction = this.position - at;
      const sample = Math.max(-1, Math.min(1, joined[at] * (1 - fraction) + joined[at + 1] * fraction));
      values.push(Math.round(sample * (sample < 0 ? 32768 : 32767)));
      this.position += step;
    }
    const used = Math.min(Math.floor(this.position), joined.length);
    this.pending = joined.slice(used); this.position -= used;
    return Int16Array.from(values);
  }
}

export function decodePcm16(base64: string): Float32Array {
  const bytes = atob(base64);
  if (bytes.length % 2 || bytes.length > 192000) throw new Error('Invalid PCM');
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const value = bytes.charCodeAt(i * 2) | bytes.charCodeAt(i * 2 + 1) << 8;
    samples[i] = (value >= 32768 ? value - 65536 : value) / 32768;
  }
  return samples;
}
