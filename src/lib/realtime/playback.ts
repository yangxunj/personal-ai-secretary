/** 用 WebAudio 时间轴吸收音频包到达抖动，不在每个包之间重新插入固定空隙。 */
export class PcmPlaybackClock {
  private cursor = 0;
  private responseId = '';
  private lastArrival: number | null = null;
  private lastDuration = 0;
  private jitter = 0;
  private chunks = 0;
  private underruns = 0;
  private maxArrivalGap = 0;
  private maxUpstreamGapMs = 0;

  get stats() {
    return { chunks: this.chunks, underruns: this.underruns,
      maxArrivalGapMs: Math.round(this.maxArrivalGap * 1000), maxUpstreamGapMs: Math.round(this.maxUpstreamGapMs),
      bufferMs: Math.round(this.bufferSeconds * 1000) };
  }
  private get bufferSeconds() { return Math.min(0.3, 0.2 + this.jitter * 3); }

  schedule(now: number, duration: number, responseId: string, upstreamGapMs = 0) {
    if (!Number.isFinite(now) || now < 0 || !Number.isFinite(duration) || duration <= 0) throw new Error('Invalid playback time');
    if (responseId !== this.responseId) {
      this.responseId = responseId; this.lastArrival = null; this.chunks = 0; this.underruns = 0;
      this.maxArrivalGap = 0; this.maxUpstreamGapMs = 0;
    }
    if (Number.isFinite(upstreamGapMs)) this.maxUpstreamGapMs = Math.max(this.maxUpstreamGapMs, upstreamGapMs);
    if (this.lastArrival !== null) {
      const gap = Math.max(0, now - this.lastArrival);
      this.maxArrivalGap = Math.max(this.maxArrivalGap, gap);
      this.jitter = this.jitter * 0.8 + Math.max(0, gap - this.lastDuration) * 0.2;
    }
    const needsBuffer = this.cursor < now + 0.01;
    if (needsBuffer && this.chunks > 0) this.underruns++;
    // 只在开始或缓冲耗尽时预留 200–300ms；已经排好的音频始终首尾相接。
    const start = needsBuffer ? now + this.bufferSeconds : this.cursor;
    if (start - now > 30) throw new Error('Playback overflow');
    this.cursor = start + duration; this.lastArrival = now; this.lastDuration = duration; this.chunks++;
    return start;
  }
  reset() {
    this.cursor = 0; this.responseId = ''; this.lastArrival = null; this.lastDuration = 0;
    this.jitter = 0; this.chunks = 0; this.underruns = 0; this.maxArrivalGap = 0; this.maxUpstreamGapMs = 0;
  }
}
