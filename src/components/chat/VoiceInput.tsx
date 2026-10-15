'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { encodeVoiceWav, VOICE_MAX_SECONDS, VOICE_SAMPLE_RATE } from '@/lib/voice-audio';

type Phase = 'idle' | 'requesting' | 'recording' | 'processing';

export default function VoiceInput({ disabled, active, onBusyChange, onTranscript }: {
  disabled: boolean;
  active: boolean;
  onBusyChange: (busy: boolean) => void;
  onTranscript: (text: string) => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  const generation = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const savedAudio = useRef<Blob | null>(null);
  // 回调始终取最新值，取消/卸载的监听器不用依赖一轮轮变化的渲染。
  const callbacks = useRef({ onBusyChange, onTranscript });
  callbacks.current = { onBusyChange, onTranscript };

  function changePhase(next: Phase) {
    setPhase(next);
    callbacks.current.onBusyChange(next !== 'idle');
  }

  function releaseMicrophone() {
    if (timer.current) clearInterval(timer.current);
    if (deadline.current) clearTimeout(deadline.current);
    timer.current = null; deadline.current = null;
    for (const track of stream.current?.getTracks() ?? []) { track.onended = null; track.stop(); }
    stream.current = null;
  }

  function dispose() {
    generation.current++;
    controller.current?.abort(); controller.current = null;
    const current = recorder.current;
    if (current) {
      current.onstop = null; current.ondataavailable = null; current.onerror = null;
      if (current.state !== 'inactive') current.stop();
    }
    recorder.current = null;
    releaseMicrophone();
    if (audioContext.current) void audioContext.current.close().catch(() => {});
    audioContext.current = null;
    savedAudio.current = null;
  }

  function cancel() {
    dispose(); setError(''); setRetry(false); setSeconds(0); changePhase('idle');
  }

  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') cancel(); };
    const leave = () => cancel();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
      dispose(); callbacks.current.onBusyChange(false);
    };
  }, []);
  useEffect(() => { if (!active) cancel(); }, [active]);

  async function recognize(audio: Blob, attempt: number) {
    changePhase('processing'); setError(''); setRetry(false);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch('/api/asr', {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(55_000)]),
      });
      const data = await response.json().catch(() => null) as { text?: unknown; error?: unknown } | null;
      if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : t('语音识别失败，请重试'));
      if (typeof data?.text !== 'string' || !data.text.trim()) throw new Error(t('没有识别到文字，请靠近麦克风重新录音'));
      if (attempt !== generation.current) return;
      callbacks.current.onTranscript(data.text.trim());
      savedAudio.current = null;
    } catch (e) {
      if (attempt !== generation.current) return;
      setError(e instanceof Error && e.name === 'TimeoutError' ? t('语音识别超时，请重试')
        : e instanceof Error && e.name !== 'TypeError' ? e.message : t('语音识别连接失败，请检查网络后重试'));
      setRetry(true);
    } finally {
      if (attempt === generation.current) { controller.current = null; changePhase('idle'); }
    }
  }

  async function prepareRecording(blob: Blob, context: AudioContext, attempt: number) {
    changePhase('processing');
    try {
      // Chrome 通常录 WebM，Safari 通常录 MP4。浏览器解码再统一为 WAV，服务端无需 FFmpeg。
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (attempt !== generation.current) return;
      const length = Math.min(Math.floor(decoded.duration * VOICE_SAMPLE_RATE), VOICE_MAX_SECONDS * VOICE_SAMPLE_RATE);
      if (length < VOICE_SAMPLE_RATE / 4) throw new Error(t('录音太短，请重新录音'));
      const offline = new OfflineAudioContext(1, length, VOICE_SAMPLE_RATE);
      const source = offline.createBufferSource();
      source.buffer = decoded; source.connect(offline.destination); source.start();
      const rendered = await offline.startRendering();
      if (attempt !== generation.current) return;
      const samples = rendered.getChannelData(0);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      if (Math.sqrt(energy / samples.length) < 0.001) throw new Error(t('没有录到声音，请检查麦克风后重试'));
      const audio = new Blob([encodeVoiceWav(samples)], { type: 'audio/wav' });
      savedAudio.current = audio;
      await recognize(audio, attempt);
    } catch (e) {
      if (attempt !== generation.current) return;
      setError(e instanceof Error && e.name === 'Error' ? e.message : t('录音处理失败，请重新录音'));
      changePhase('idle');
    } finally {
      void context.close().catch(() => {});
      if (audioContext.current === context) audioContext.current = null;
    }
  }

  function finish() {
    if (recorder.current?.state !== 'recording') return;
    changePhase('processing');
    recorder.current.stop();
    releaseMicrophone();
  }

  async function start() {
    if (disabled || !active || phase !== 'idle') return;
    cancel();
    if (!window.isSecureContext) { setError(t('语音输入需要 HTTPS，请使用安全地址或在本机打开')); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined') {
      setError(t('当前浏览器不支持录音，请使用新版 Chrome、Edge 或 Safari')); return;
    }
    const attempt = generation.current;
    changePhase('requesting');
    let context: AudioContext | null = null;
    try {
      // 在用户点击内激活音频上下文，兼容手机浏览器的手势限制。
      context = new AudioContext(); audioContext.current = context;
      await context.resume();
      if (attempt !== generation.current) return;
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      if (attempt !== generation.current) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
      const current = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      recorder.current = current;
      const chunks: Blob[] = [];
      current.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      current.onstop = () => {
        if (attempt !== generation.current) return;
        recorder.current = null; releaseMicrophone();
        void prepareRecording(new Blob(chunks, { type: current.mimeType }), context!, attempt);
      };
      current.onerror = () => { cancel(); setError(t('录音中断，请检查麦克风后重试')); };
      for (const track of media.getAudioTracks()) track.onended = () => { cancel(); setError(t('录音中断，请检查麦克风后重试')); };
      current.start();
      const started = performance.now();
      changePhase('recording');
      timer.current = setInterval(() => setSeconds(Math.min(VOICE_MAX_SECONDS, Math.floor((performance.now() - started) / 1000))), 250);
      deadline.current = setTimeout(finish, VOICE_MAX_SECONDS * 1000);
    } catch (e) {
      if (attempt !== generation.current) return;
      cancel();
      setError(e instanceof Error && ['NotAllowedError', 'SecurityError'].includes(e.name)
        ? t('无法访问麦克风，请在浏览器和系统设置中允许录音')
        : e instanceof Error && e.name === 'NotFoundError' ? t('没有找到麦克风，请连接后重试')
          : t('无法启动录音，请检查麦克风是否被占用'));
    }
  }

  return <>
    <button type="button" onClick={phase === 'recording' ? finish : start} disabled={disabled || phase === 'requesting' || phase === 'processing'}
      aria-label={phase === 'recording' ? t('完成录音') : t('语音输入')} aria-pressed={phase === 'recording'}
      className={`shrink-0 rounded-full w-10 h-10 border flex items-center justify-center disabled:opacity-30 ${phase === 'recording' ? 'text-red-500 bg-red-500/10 border-red-500' : 'muted'}`}
      style={phase === 'recording' ? undefined : { borderColor: 'var(--border)' }}>
      {phase === 'recording' ? <span aria-hidden="true">■</span> : <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
      </svg>}
    </button>
    {(phase !== 'idle' || error) && <div className="order-last basis-full flex flex-wrap items-center gap-2 text-xs pt-1" role="status" aria-live="polite">
      <span className={error ? 'text-red-500' : 'muted'}>{error || (phase === 'requesting' ? t('等待麦克风权限…')
        : phase === 'recording' ? t('正在录音 {s} / 60 秒', { s: seconds }) : t('正在识别语音…'))}</span>
      {phase === 'recording' && <button type="button" className="text-brand-500 underline px-2 py-1" onClick={finish}>{t('完成录音')}</button>}
      {retry && <button type="button" disabled={disabled} className="text-brand-500 underline px-2 py-1 disabled:opacity-30" onClick={() => {
        if (savedAudio.current) void recognize(savedAudio.current, generation.current);
      }}>{t('重试识别')}</button>}
      <button type="button" className="muted underline px-2 py-1" onClick={cancel}>{t('取消')}</button>
    </div>}
  </>;
}
