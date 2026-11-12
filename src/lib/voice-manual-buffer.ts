/** A bounded, memory-only recording for explicit user submission. */
export class VoiceManualBuffer {
  private frames: Float32Array[] = [];
  private samples = 0;
  readonly maxSamples: number;
  constructor(readonly sampleRate: number) { this.maxSamples = Math.floor(sampleRate * 60); }
  reset() { this.frames = []; this.samples = 0; }
  append(frame: Float32Array): boolean {
    const length = Math.min(frame.length, this.maxSamples - this.samples);
    if (length > 0) { this.frames.push(frame.slice(0, length)); this.samples += length; }
    return this.samples >= this.maxSamples;
  }
  take(): { status: 'empty' | 'short' | 'silent' | 'ok'; audio?: Float32Array } {
    if (!this.samples) return { status: 'empty' };
    if (this.samples < this.sampleRate / 4) return { status: 'short' };
    const audio = new Float32Array(this.samples);
    let offset = 0, nonzero = false;
    for (const frame of this.frames) {
      audio.set(frame, offset); offset += frame.length;
      if (!nonzero) nonzero = frame.some(sample => sample !== 0);
    }
    this.reset();
    return nonzero ? { status: 'ok', audio } : { status: 'silent' };
  }
}
