'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { beginVoiceSession, endVoiceSession } from '@/lib/voice-session';
import { PcmResampler, decodePcm16 } from '@/lib/realtime/audio';
import { hasSpeechRecording, setSpeechRecording, stopSpeechPlayback } from './SpeechButton';

type Phase = 'off' | 'connecting' | 'listening' | 'thinking' | 'speaking';
type Job = { id: string; status: string; transcript?: string };
export default function RealtimeVoice({ conversationId, taskId, active, disabled, onRunningChange, onPersisted, onHeard }: {
  conversationId: string; taskId?: string; active: boolean; disabled: boolean;
  onRunningChange: (running: boolean) => void; onPersisted: () => void; onHeard: (text: string) => void;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('off'), [error, setError] = useState('');
  const [heard, setHeard] = useState(''), [reply, setReply] = useState(''), [jobs, setJobs] = useState<Job[]>([]);
  const currentPhase = useRef<Phase>('off'), generation = useRef(0), owner = useRef({});
  const audio = useRef<AudioContext | null>(null), media = useRef<MediaStream | null>(null);
  const capture = useRef<AudioWorkletNode | null>(null), input = useRef<MediaStreamAudioSourceNode | null>(null);
  const controller = useRef<AbortController | null>(null), sessionId = useRef('');
  const sources = useRef(new Set<AudioBufferSourceNode>()), timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const playback = useRef(new Map<string, { count: number; done: boolean; started: boolean }>());
  const suppressed = useRef(new Set<string>()), cursor = useRef(0), lastResponse = useRef('');
  const callbacks = useRef({ onRunningChange, onPersisted, onHeard }); callbacks.current = { onRunningChange, onPersisted, onHeard };
  const change = (next: Phase) => { currentPhase.current = next; setPhase(next); };
  function clearPlayback() {
    for (const id of playback.current.keys()) suppressed.current.add(id);
    if (suppressed.current.size > 100) suppressed.current = new Set([...suppressed.current].slice(-50));
    for (const timer of timers.current) clearTimeout(timer); timers.current.clear();
    for (const source of sources.current) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
    sources.current.clear(); playback.current.clear(); cursor.current = 0;
  }
  function dispose(update = true) {
    generation.current++; currentPhase.current = 'off';
    controller.current?.abort(); controller.current = null;
    const id = sessionId.current; sessionId.current = '';
    if (id) void fetch(`/api/realtime?id=${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
    clearPlayback();
    if (capture.current) { capture.current.port.onmessage = null; capture.current.disconnect(); capture.current.onprocessorerror = null; }
    capture.current = null; input.current?.disconnect(); input.current = null;
    for (const track of media.current?.getTracks() ?? []) { track.onended = null; track.stop(); } media.current = null;
    const context = audio.current; audio.current = null;
    if (context) { context.onstatechange = null; void context.close().catch(() => {}); }
    setSpeechRecording(owner.current, false); endVoiceSession(owner.current); callbacks.current.onRunningChange(false);
    if (update) setPhase('off');
  }
  function fail(message: string) { dispose(); setError(message); }
  const alive = (attempt: number) => generation.current === attempt && currentPhase.current !== 'off';
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') dispose(); };
    const leave = () => dispose();
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', leave);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave); dispose(false); };
  }, []);
  useEffect(() => { if (!active) dispose(); }, [active]);

  async function control(type: string, responseId: string, attempt: number) {
    if (!alive(attempt)) return;
    try {
      const response = await fetch(`/api/realtime?id=${sessionId.current}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, responseId }), signal: AbortSignal.any([controller.current!.signal, AbortSignal.timeout(8000)]) });
      if (!response.ok && alive(attempt)) fail(t('实时语音连接中断，请检查模型、密钥和网络后重新开启'));
    } catch { if (alive(attempt)) fail(t('实时语音连接中断，请检查模型、密钥和网络后重新开启')); }
  }
  function finishPlayback(id: string, attempt: number) {
    const item = playback.current.get(id);
    if (item?.done && !item.count) { playback.current.delete(id); void control('playback.ended', id, attempt); }
  }
  function play(base64: string, id: string, attempt: number) {
    if (suppressed.current.has(id)) return;
    const context = audio.current!, values = decodePcm16(base64);
    if (!values.length) return;
    const start = Math.max(context.currentTime + 0.025, cursor.current);
    if (start - context.currentTime > 30) throw new Error('Playback overflow');
    const buffer = context.createBuffer(1, values.length, 24000); buffer.copyToChannel(new Float32Array(values), 0);
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    let item = playback.current.get(id);
    if (!item) { item = { count: 0, done: false, started: false }; playback.current.set(id, item); }
    item.count++; sources.current.add(source);
    if (!item.started) {
      item.started = true;
      const timer = setTimeout(() => { timers.current.delete(timer); if (alive(attempt) && !suppressed.current.has(id)) void control('playback.started', id, attempt); }, Math.max(0, (start - context.currentTime) * 1000));
      timers.current.add(timer);
    }
    source.onended = () => {
      sources.current.delete(source); source.disconnect();
      const item = playback.current.get(id); if (item) item.count--;
      if (alive(attempt)) finishPlayback(id, attempt);
    };
    cursor.current = start + buffer.duration; source.start(start);
  }
  function receive(event: any, attempt: number) {
    if (!alive(attempt)) return;
    if (event.type === 'ready') change('listening');
    if (event.type === 'state' && ['listening', 'thinking', 'speaking'].includes(event.state)) change(event.state);
    if (event.type === 'clear') { clearPlayback(); lastResponse.current = ''; setReply(''); }
    if (event.type === 'audio') play(event.audio, event.responseId, attempt);
    if (event.type === 'audio.done') {
      const item = playback.current.get(event.responseId);
      if (item) { item.done = true; finishPlayback(event.responseId, attempt); }
    }
    if (event.type === 'transcript') {
      if (event.role === 'user') { setHeard(event.text); callbacks.current.onHeard(event.text); }
      else {
        const fresh = lastResponse.current !== event.responseId; lastResponse.current = event.responseId;
        setReply(previous => (fresh ? '' : previous) + event.delta);
      }
    }
    if (event.type === 'job') setJobs(previous => [...previous.filter(job => job.id !== event.job.id), event.job].slice(-8));
    if (event.type === 'jobs') setJobs(event.jobs);
    if (event.type === 'persisted') callbacks.current.onPersisted();
    if (event.type === 'error') fail(event.message);
    if (event.type === 'closed' && alive(attempt)) dispose();
  }
  async function readEvents(id: string, attempt: number, signal: AbortSignal) {
    const response = await fetch(`/api/realtime?id=${id}`, { signal });
    if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Voice event stream failed');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
    try {
      while (alive(attempt)) {
        const { value, done } = await reader.read(); if (done) break;
        pending += decoder.decode(value, { stream: true });
        if (pending.length > 300000) throw new Error('Voice event too large');
        const blocks = pending.split('\n\n'); pending = blocks.pop() || '';
        for (const block of blocks) if (block.startsWith('data: ')) receive(JSON.parse(block.slice(6)), attempt);
      }
      if (alive(attempt)) throw new Error('Voice connection closed');
    } finally { reader.releaseLock(); }
  }
  async function start() {
    if (disabled || !active || currentPhase.current !== 'off') return;
    if (hasSpeechRecording()) { setError(t('请先完成或取消当前录音')); return; }
    if (!window.isSecureContext) { setError(t('语音输入需要 HTTPS，请使用安全地址或在本机打开')); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
      setError(t('当前浏览器不支持连续语音，请使用新版 Chrome、Edge 或 Safari')); return;
    }
    dispose(); setError(''); setHeard(''); setReply(''); setJobs([]); suppressed.current.clear();
    beginVoiceSession(owner.current, () => dispose()); setSpeechRecording(owner.current, true); stopSpeechPlayback();
    change('connecting'); callbacks.current.onRunningChange(true);
    const attempt = generation.current, abort = new AbortController(); controller.current = abort;
    try {
      const context = new AudioContext(); audio.current = context; await context.resume();
      if (!alive(attempt)) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (!alive(attempt)) { stream.getTracks().forEach(track => track.stop()); return; } media.current = stream;
      const response = await fetch('/api/realtime', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, ...(taskId ? { taskId } : {}) }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]) });
      const data = await response.json();
      if (!alive(attempt)) { if (data.id) void fetch(`/api/realtime?id=${data.id}`, { method: 'DELETE' }).catch(() => {}); return; }
      if (!response.ok) { fail(typeof data.error === 'string' ? data.error : t('无法开启实时语音，请检查配置后重试')); return; }
      sessionId.current = data.id;
      void readEvents(data.id, attempt, abort.signal).catch(() => { if (alive(attempt)) fail(t('实时语音连接中断，请检查模型、密钥和网络后重新开启')); });
      await context.audioWorklet.addModule('/worklets/voice-capture.js');
      if (!alive(attempt)) return;
      const node = new AudioWorkletNode(context, 'voice-capture', { outputChannelCount: [1] }); capture.current = node;
      input.current = context.createMediaStreamSource(stream);
      const resampler = new PcmResampler(context.sampleRate);
      let chunks: Int16Array[] = [], samples = 0, uploading = false, sequence = 0;
      const upload = async () => {
        if (uploading || samples < 2560 || !alive(attempt)) return;
        uploading = true;
        const packet = new Int16Array(samples); let offset = 0;
        for (const chunk of chunks) { packet.set(chunk, offset); offset += chunk.length; } chunks = []; samples = 0;
        try {
          const sent = await fetch(`/api/realtime?id=${data.id}&sequence=${sequence++}`, { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' },
            body: packet.buffer, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]) });
          if (!sent.ok) throw new Error('Voice upload failed');
        } catch { if (alive(attempt)) fail(t('实时语音连接中断，请检查模型、密钥和网络后重新开启')); }
        finally { uploading = false; if (alive(attempt)) void upload(); }
      };
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!alive(attempt) || currentPhase.current === 'connecting') return;
        const pcm = resampler.push(event.data); chunks.push(pcm); samples += pcm.length;
        if (samples > 8000) { fail(t('网络过慢，实时语音已停止，请检查网络后重试')); return; }
        void upload();
      };
      node.onprocessorerror = () => { if (alive(attempt)) fail(t('语音检测中断，请重新开启语音对话')); };
      context.onstatechange = () => { if (alive(attempt) && context.state !== 'running') fail(t('音频已暂停，请重新开启语音对话')); };
      for (const track of stream.getAudioTracks()) track.onended = () => { if (alive(attempt)) fail(t('录音中断，请检查麦克风后重试')); };
      input.current.connect(node); node.connect(context.destination);
    } catch (e) {
      if (alive(attempt)) fail(e instanceof Error && ['NotAllowedError', 'SecurityError'].includes(e.name)
        ? t('无法访问麦克风，请在浏览器和系统设置中允许录音') : t('无法开启实时语音，请检查配置后重试'));
    }
  }
  const labels = { off: '', connecting: t('正在连接实时语音…'), listening: t('正在聆听，可以随时插话'), thinking: t('正在理解你的话…'), speaking: t('正在回答，可以直接插话') };
  const pending = jobs.filter(job => ['queued', 'running'].includes(job.status)).length;
  return <div className="mb-2 text-xs" data-realtime-voice>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={phase === 'off' ? start : () => dispose()} disabled={phase === 'off' && (disabled || !active)} aria-pressed={phase !== 'off'}
        className="rounded-full border px-3 py-2 text-brand-600 dark:text-brand-300 disabled:opacity-30" style={{ borderColor: 'var(--border)' }}>{phase === 'off' ? t('开启实时语音') : t('结束实时语音')}</button>
      {phase !== 'off' && <span role="status" aria-live="polite" className="muted">{labels[phase]}</span>}
    </div>
    {phase !== 'off' && <div className="muted mt-1 space-y-1 leading-relaxed break-words">
      <p>{t('开启后持续发送麦克风音频，可在 AI 说话时插话；切到后台会结束。')}</p>
      {pending > 0 && <p>{t('后台正在处理 {n} 个请求，你可以继续交谈', { n: pending })}</p>}
      {heard && <p>{t('已听到：{text}', { text: heard })}</p>}
      {reply && <p className="max-h-24 overflow-auto">{reply}</p>}
    </div>}
    {error && <p role="alert" className="text-red-500 mt-1">{error}</p>}
  </div>;
}
