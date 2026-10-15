'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { beginVoiceSession, endVoiceSession, voiceSessionOwner } from '@/lib/voice-session';
import { encodeVoiceWav, VOICE_SAMPLE_RATE } from '@/lib/voice-audio';
import { TurnDetector } from '@/lib/turn-detector';
import { speechText, speechChunks } from '@/lib/speech-text';
import { hasSpeechRecording, setSpeechRecording, stopSpeechPlayback } from './SpeechButton';

type Phase = 'off' | 'requesting' | 'listening' | 'recording' | 'transcribing' | 'waiting' | 'speaking';

export default function VoiceConversation({ active, disabled, onRunningChange, onSubmit }: {
  active: boolean;
  disabled: boolean;
  onRunningChange: (running: boolean) => void;
  onSubmit: (text: string, signal: AbortSignal) => Promise<string>;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('off');
  const [error, setError] = useState('');
  const [heard, setHeard] = useState('');
  const phaseRef = useRef<Phase>('off');
  const owner = useRef({});
  const generation = useRef(0);
  const context = useRef<AudioContext | null>(null);
  const media = useRef<MediaStream | null>(null);
  const input = useRef<MediaStreamAudioSourceNode | null>(null);
  const capture = useRef<AudioWorkletNode | null>(null);
  const player = useRef<AudioBufferSourceNode | null>(null);
  const detector = useRef<TurnDetector | null>(null);
  const abort = useRef<AbortController | null>(null);
  const coolDown = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ onRunningChange, onSubmit });
  callbacks.current = { onRunningChange, onSubmit };

  function change(next: Phase) { phaseRef.current = next; setPhase(next); }
  function dispose(update = true) {
    generation.current++;
    phaseRef.current = 'off';
    abort.current?.abort(); abort.current = null;
    if (coolDown.current) clearTimeout(coolDown.current);
    coolDown.current = null;
    if (player.current) { try { player.current.stop(); } catch {} player.current.disconnect(); }
    player.current = null;
    if (capture.current) { capture.current.port.onmessage = null; capture.current.onprocessorerror = null; capture.current.disconnect(); }
    capture.current = null; input.current?.disconnect(); input.current = null;
    for (const track of media.current?.getTracks() ?? []) { track.onended = null; track.stop(); }
    media.current = null;
    const audio = context.current; context.current = null;
    if (audio) { audio.onstatechange = null; void audio.close().catch(() => {}); }
    detector.current?.reset(); detector.current = null;
    setSpeechRecording(owner.current, false); endVoiceSession(owner.current);
    callbacks.current.onRunningChange(false);
    if (update) setPhase('off');
  }
  function fail(message: string) { dispose(); setError(message); }
  const current = (attempt: number) => attempt === generation.current && phaseRef.current !== 'off';

  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') dispose(); };
    const leave = () => dispose();
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave);
      dispose(false);
    };
  }, []);
  useEffect(() => { if (!active) dispose(); }, [active]);

  function listen(attempt: number, delay = 0) {
    if (!current(attempt)) return;
    detector.current?.reset();
    const resume = () => {
      if (!current(attempt)) return;
      for (const track of media.current?.getAudioTracks() ?? []) track.enabled = true;
      change('listening');
    };
    if (delay) coolDown.current = setTimeout(resume, delay);
    else resume();
  }

  async function converse(samples: Float32Array, attempt: number) {
    const audio = context.current!, signal = abort.current!.signal;
    change('transcribing');
    for (const track of media.current?.getAudioTracks() ?? []) track.enabled = false;
    try {
      const length = Math.min(VOICE_SAMPLE_RATE * 60, Math.floor(samples.length / audio.sampleRate * VOICE_SAMPLE_RATE));
      const offline = new OfflineAudioContext(1, length, VOICE_SAMPLE_RATE);
      const buffer = offline.createBuffer(1, samples.length, audio.sampleRate);
      buffer.copyToChannel(new Float32Array(samples), 0);
      const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
      const rendered = await offline.startRendering();
      if (!current(attempt)) return;
      const response = await fetch('/api/asr', {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: encodeVoiceWav(rendered.getChannelData(0)),
        signal: AbortSignal.any([signal, AbortSignal.timeout(55_000)]),
      });
      const data = await response.json().catch(() => null);
      if (!current(attempt)) return;
      // 无声/未识别时不提交 Agent，也不重发上一句话。
      if (response.status === 422) { listen(attempt); return; }
      if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : t('语音识别失败，请重试'));
      if (typeof data?.text !== 'string') throw new Error(t('语音识别失败，请重试'));
      if (!data.text.trim()) { listen(attempt); return; }
      setHeard(data.text.trim()); change('waiting');
      const reply = await callbacks.current.onSubmit(data.text.trim(), signal);
      if (!current(attempt)) return;
      const parts = speechChunks(speechText(reply) || t('回答已显示在聊天中'));
      change('speaking');
      for (const text of parts) {
        const speech = await fetch('/api/tts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(70_000)]),
        });
        if (!speech.ok || !speech.headers.get('content-type')?.startsWith('audio/')) {
          const problem = await speech.json().catch(() => null);
          throw new Error(typeof problem?.error === 'string' ? problem.error : t('语音合成失败，请重试'));
        }
        const bytes = await speech.arrayBuffer();
        if (!current(attempt)) return;
        if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw new Error(t('语音合成失败，请重试'));
        const decoded = await audio.decodeAudioData(bytes);
        if (!current(attempt)) return;
        await new Promise<void>((resolve) => {
          const output = audio.createBufferSource(); output.buffer = decoded; output.connect(audio.destination);
          player.current = output;
          output.onended = () => { output.disconnect(); if (player.current === output) player.current = null; resolve(); };
          output.start();
        });
        if (!current(attempt)) return;
      }
      // 留一点扬声器回声消退时间，整段朗读期间麦克风轨道始终静音。
      listen(attempt, 350);
    } catch (e) {
      if (!current(attempt)) return;
      fail(e instanceof Error && e.name === 'Error' ? e.message : t('语音对话中断，请检查网络后重新开启'));
    }
  }

  async function start() {
    if (!active || disabled || phaseRef.current !== 'off') return;
    if (hasSpeechRecording() && !voiceSessionOwner()) { setError(t('请先完成或取消当前录音')); return; }
    if (!window.isSecureContext) { setError(t('语音输入需要 HTTPS，请使用安全地址或在本机打开')); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
      setError(t('当前浏览器不支持连续语音，请使用新版 Chrome、Edge 或 Safari')); return;
    }
    dispose(); setError(''); setHeard('');
    beginVoiceSession(owner.current, () => dispose());
    stopSpeechPlayback(); setSpeechRecording(owner.current, true);
    abort.current = new AbortController(); change('requesting'); callbacks.current.onRunningChange(true);
    const attempt = generation.current;
    try {
      // 开启按钮内解锁同一个音频上下文，后续轮次通过 Web Audio 自动播放。
      const audio = new AudioContext(); context.current = audio;
      await audio.resume();
      if (!current(attempt)) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      if (!current(attempt)) { stream.getTracks().forEach(track => track.stop()); return; }
      media.current = stream;
      await audio.audioWorklet.addModule('/worklets/voice-capture.js');
      if (!current(attempt)) return;
      const worklet = new AudioWorkletNode(audio, 'voice-capture', { outputChannelCount: [1] });
      capture.current = worklet; input.current = audio.createMediaStreamSource(stream);
      worklet.onprocessorerror = () => { if (current(attempt)) fail(t('语音检测中断，请重新开启语音对话')); };
      detector.current = new TurnDetector(audio.sampleRate);
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!current(attempt) || !['listening', 'recording'].includes(phaseRef.current)) return;
        const result = detector.current!.push(event.data);
        if (result.started) change('recording');
        if (result.discarded) change('listening');
        if (result.audio) void converse(result.audio, attempt);
      };
      input.current.connect(worklet); worklet.connect(audio.destination);
      for (const track of stream.getAudioTracks()) track.onended = () => { if (current(attempt)) fail(t('录音中断，请检查麦克风后重试')); };
      audio.onstatechange = () => { if (current(attempt) && audio.state !== 'running') fail(t('音频已暂停，请重新开启语音对话')); };
      listen(attempt);
    } catch (e) {
      if (!current(attempt)) return;
      fail(e instanceof Error && ['NotAllowedError', 'SecurityError'].includes(e.name)
        ? t('无法访问麦克风，请在浏览器和系统设置中允许录音') : t('无法开启语音对话，请检查麦克风和浏览器支持'));
    }
  }

  const labels: Record<Phase, string> = {
    off: '', requesting: t('等待麦克风权限…'), listening: t('正在聆听，你可以说话'), recording: t('听到你在说话，停顿后会自动发送'),
    transcribing: t('正在识别语音…'), waiting: t('AI 正在处理，请稍等'), speaking: t('正在合成并朗读，播完后继续听'),
  };
  return <div className="mb-2 text-xs" data-voice-conversation>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={phase === 'off' ? start : () => dispose()} disabled={phase === 'off' && (!active || disabled)}
        aria-pressed={phase !== 'off'} className="rounded-full border px-3 py-2 text-brand-600 dark:text-brand-300 disabled:opacity-30"
        style={{ borderColor: 'var(--border)' }}>{phase === 'off' ? t('开启语音对话') : t('退出语音对话')}</button>
      {phase !== 'off' && <span className="muted" role="status" aria-live="polite">{labels[phase]}</span>}
    </div>
    {phase !== 'off' && <p className="muted mt-1 leading-relaxed">{t('说完停顿约 1.2 秒后自动发送，每轮最长 60 秒。AI 回答时暂停收音。')}</p>}
    {phase !== 'off' && <p className="muted mt-1 leading-relaxed">{t('当前草稿和附件会保留，语音对话只发送你说的话。')}</p>}
    {phase !== 'off' && heard && <p className="muted mt-1 break-words">{t('已听到：{text}', { text: heard })}</p>}
    {error && <p className="text-red-500 mt-1" role="alert">{error}</p>}
  </div>;
}
