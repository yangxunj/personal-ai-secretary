// 16kHz 单声道 PCM。正常每 160ms 发包，积压时合并，单包最多两秒。
export const AUDIO_PACKET_MIN_SAMPLES = 2560;
export const AUDIO_PACKET_MAX_SAMPLES = 32000;
export const AUDIO_BUFFER_MAX_SAMPLES = 16000 * 12;
export const REALTIME_IDLE_TIMEOUT_MS = 30_000;

class RejectedPacket extends Error {}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/** 只用于幂等的音频序号/播放回执；绝不重试创建会话或 Agent 业务请求。 */
export async function sendRealtimePacket(url: string, body: ArrayBuffer | string, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, { method: 'PATCH',
        headers: { 'Content-Type': typeof body === 'string' ? 'application/json' : 'application/octet-stream' },
        body, signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) });
      if (response.status === 204) return;
      void response.body?.cancel().catch(() => {});
      if (![408, 429].includes(response.status) && response.status < 500) throw new RejectedPacket('Voice session unavailable');
      throw new Error('Temporary voice upload failure');
    } catch (error) {
      if (signal.aborted || error instanceof RejectedPacket || attempt >= 2) throw error;
      await delay(250 * 2 ** attempt, signal);
    }
  }
}

/** 单路上传保序；请求未确认前保留原包和序号，避免丢字、重音和并发乱序。 */
export class PcmUploadQueue {
  private chunks: Int16Array[] = [];
  private offset = 0;
  private samples = 0;
  private inFlight = 0;
  private sending = false;
  private stopped = false;
  private congested = false;
  private sequence = 0;

  constructor(private options: {
    send: (packet: Int16Array, sequence: number) => Promise<void>;
    onCongestion: (congested: boolean) => void;
    onError: (reason: 'overflow' | 'upload') => void;
  }) {}

  push(pcm: Int16Array) {
    if (this.stopped || !pcm.length) return;
    if (this.samples + this.inFlight + pcm.length > AUDIO_BUFFER_MAX_SAMPLES) { this.fail('overflow'); return; }
    this.chunks.push(pcm); this.samples += pcm.length;
    this.reportCongestion();
    void this.drain();
  }
  stop() { this.stopped = true; this.chunks = []; this.samples = 0; this.offset = 0; }
  private reportCongestion() {
    // 超过一秒才提示；恢复到半秒以内再消除，避免边界来回闪动。
    const buffered = this.samples + this.inFlight;
    const next = buffered > (this.congested ? 8000 : 16000);
    if (next !== this.congested) { this.congested = next; this.options.onCongestion(next); }
  }
  private fail(reason: 'overflow' | 'upload') { this.stop(); this.options.onError(reason); }
  private take() {
    const packet = new Int16Array(Math.min(this.samples, AUDIO_PACKET_MAX_SAMPLES));
    let filled = 0;
    while (filled < packet.length) {
      const chunk = this.chunks[0], length = Math.min(chunk.length - this.offset, packet.length - filled);
      packet.set(chunk.subarray(this.offset, this.offset + length), filled);
      filled += length; this.offset += length;
      if (this.offset === chunk.length) { this.chunks.shift(); this.offset = 0; }
    }
    this.samples -= packet.length; return packet;
  }
  private async drain() {
    if (this.sending || this.stopped) return;
    this.sending = true;
    try {
      while (!this.stopped && this.samples >= AUDIO_PACKET_MIN_SAMPLES) {
        const packet = this.take(); this.inFlight = packet.length;
        await this.options.send(packet, this.sequence);
        if (this.stopped) return;
        this.sequence++; this.inFlight = 0; this.reportCongestion();
      }
    } catch { if (!this.stopped) this.fail('upload'); }
    finally { this.sending = false; }
  }
}
