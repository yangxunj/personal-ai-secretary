/** 本地能量检测：连续发声启动、静音收尾、短脉冲过滤，环形预录避免吃掉句首。 */
export class TurnDetector {
  private preRoll: Float32Array[] = [];
  private preSamples = 0;
  private frames: Float32Array[] = [];
  private samples = 0;
  private hotMs = 0;
  private voicedMs = 0;
  private quietMs = 0;
  private noise = 0.002;
  private recording = false;

  constructor(private readonly sampleRate: number) {}

  reset() {
    this.preRoll = []; this.preSamples = 0; this.frames = []; this.samples = 0;
    this.hotMs = 0; this.voicedMs = 0; this.quietMs = 0; this.recording = false;
  }

  push(frame: Float32Array): { started?: boolean; discarded?: boolean; audio?: Float32Array; limit?: boolean } {
    const ms = frame.length / this.sampleRate * 1000;
    let energy = 0;
    for (const value of frame) energy += value * value;
    const rms = Math.sqrt(energy / frame.length);
    const voiced = rms > Math.max(0.012, this.noise * 3.5);
    if (!this.recording) {
      this.preRoll.push(frame); this.preSamples += frame.length;
      while (this.preSamples > this.sampleRate * 0.3 && this.preRoll.length > 1) this.preSamples -= this.preRoll.shift()!.length;
      this.hotMs = voiced ? this.hotMs + ms : 0;
      if (!voiced) this.noise = this.noise * 0.98 + Math.min(rms, 0.01) * 0.02;
      if (this.hotMs < 120) return {};
      this.recording = true; this.frames = this.preRoll; this.samples = this.preSamples;
      this.preRoll = []; this.preSamples = 0; this.voicedMs = this.hotMs;
      return { started: true };
    }
    this.frames.push(frame); this.samples += frame.length;
    this.quietMs = voiced ? 0 : this.quietMs + ms;
    if (voiced) this.voicedMs += ms;
    const limit = this.samples >= this.sampleRate * 59.5;
    if (!limit && this.quietMs < 1200) return {};
    if (this.voicedMs < 300) { this.reset(); return { discarded: true }; }
    // 去掉尾部多余静音，只留约 200ms；长度仍受服务端 WAV 校验保护。
    const trailing = Math.max(0, Math.round((this.quietMs - 200) / 1000 * this.sampleRate));
    const audio = new Float32Array(this.samples - trailing);
    let offset = 0;
    for (const chunk of this.frames) {
      if (offset >= audio.length) break;
      const count = Math.min(chunk.length, audio.length - offset);
      audio.set(chunk.subarray(0, count), offset); offset += count;
    }
    this.reset();
    return { audio, limit };
  }
}
