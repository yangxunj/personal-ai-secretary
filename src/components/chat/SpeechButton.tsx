'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useT } from '@/lib/i18n/client';
import { speechChunks, speechText } from '@/lib/speech-text';

// 跨主聊天和任务窗口只允许一段朗读；缓存只留最近一次回答，最多 12MB，全部在内存中。
let currentStop: (() => void) | null = null;
let cacheOwner: object | null = null;
let cachedAudio = new Map<number, Blob>();
let cachedBytes = 0;
export function stopSpeechPlayback() { currentStop?.(); }
const recordingOwners = new Set<object>();
const recordingListeners = new Set<() => void>();
const subscribeRecording = (listener: () => void) => {
  recordingListeners.add(listener);
  return () => { recordingListeners.delete(listener); };
};
const recordingSnapshot = () => recordingOwners.size > 0;
export const hasSpeechRecording = recordingSnapshot;
const serverRecordingSnapshot = () => false;
export function setSpeechRecording(owner: object, recording: boolean) {
  const previous = recordingSnapshot();
  if (recording) { recordingOwners.add(owner); stopSpeechPlayback(); }
  else recordingOwners.delete(owner);
  if (previous !== recordingSnapshot()) for (const listener of recordingListeners) listener();
}

type Phase = 'idle' | 'loading' | 'ready' | 'playing' | 'paused';

export default function SpeechButton({ text, active = true, disabled = false }: { text: string; active?: boolean; disabled?: boolean }) {
  const t = useT();
  const recordingBlocked = useSyncExternalStore(subscribeRecording, recordingSnapshot, serverRecordingSnapshot);
  const chunks = useMemo(() => speechChunks(speechText(text)), [text]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [part, setPart] = useState(0);
  const owner = useRef({});
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const stopSelf = useRef(() => stopRef.current());

  function releaseAudio() {
    if (audio.current) {
      audio.current.onended = null; audio.current.onplay = null; audio.current.onpause = null; audio.current.onerror = null;
      audio.current.pause(); audio.current.removeAttribute('src'); audio.current.load();
    }
    audio.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = '';
  }

  function stop(update = true) {
    generation.current++;
    controller.current?.abort(); controller.current = null;
    releaseAudio();
    if (currentStop === stopSelf.current) currentStop = null;
    if (update) { setPhase('idle'); setPart(0); }
  }
  stopRef.current = () => stop();

  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') stopRef.current(); };
    const leave = () => stopRef.current();
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leave);
      stop(false);
      if (cacheOwner === owner.current) { cacheOwner = null; cachedAudio.clear(); cachedBytes = 0; }
    };
  }, []);
  useEffect(() => { if (!active || disabled) stop(); }, [active, disabled]);
  useEffect(() => {
    stop(); setError('');
    if (cacheOwner === owner.current) { cacheOwner = null; cachedAudio.clear(); cachedBytes = 0; }
  }, [text]);

  async function playPrepared(attempt: number) {
    try { await audio.current?.play(); }
    catch (e) {
      if (attempt !== generation.current) return;
      if (e instanceof Error && e.name === 'NotAllowedError') setPhase('ready');
      else { stop(); setError(t('音频播放失败，请重新朗读')); }
    }
  }

  async function loadPart(index: number, attempt: number) {
    if (attempt !== generation.current) return;
    releaseAudio(); setPart(index + 1); setPhase('loading');
    const abort = new AbortController(); controller.current = abort;
    try {
      let blob = cacheOwner === owner.current ? cachedAudio.get(index) : undefined;
      if (!blob) {
        const response = await fetch('/api/tts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: chunks[index] }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(70_000)]),
        });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) {
          const data = await response.json().catch(() => null);
          throw new Error(typeof data?.error === 'string' ? data.error : t('语音合成失败，请重试'));
        }
        blob = await response.blob();
        if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error(t('语音合成失败，请重试'));
        if (attempt !== generation.current) return;
        if (cacheOwner !== owner.current) { cacheOwner = owner.current; cachedAudio.clear(); cachedBytes = 0; }
        if (cachedBytes + blob.size <= 12 * 1024 * 1024) { cachedAudio.set(index, blob); cachedBytes += blob.size; }
      }
      if (attempt !== generation.current) return;
      controller.current = null;
      const player = new Audio(); audio.current = player;
      objectUrl.current = URL.createObjectURL(blob); player.src = objectUrl.current;
      player.onplay = () => { if (attempt === generation.current) setPhase('playing'); };
      player.onpause = () => { if (attempt === generation.current && !player.ended) setPhase('paused'); };
      player.onerror = () => { if (attempt === generation.current) { stop(); setError(t('音频播放失败，请重新朗读')); } };
      player.onended = () => {
        if (attempt !== generation.current) return;
        if (index + 1 < chunks.length) void loadPart(index + 1, attempt);
        else stop();
      };
      await playPrepared(attempt);
    } catch (e) {
      if (attempt !== generation.current) return;
      stop();
      setError(e instanceof Error && e.name === 'TimeoutError' ? t('语音合成超时，请重试')
        : e instanceof Error && e.name === 'Error' ? e.message : t('语音合成连接失败，请检查网络后重试'));
    }
  }

  function start() {
    stopSpeechPlayback(); stop(); setError('');
    if (!active || disabled || recordingSnapshot() || !chunks.length) return;
    currentStop = stopSelf.current;
    void loadPart(0, generation.current);
  }

  if (!chunks.length) return null;
  return <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-speech-controls>
    <button type="button" onClick={phase === 'idle' ? start : () => stop()} disabled={!active || disabled || recordingBlocked}
      className="muted inline-flex items-center gap-1 py-1 hover:underline disabled:opacity-30">
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M11 5 6 9H3v6h3l5 4V5Z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14" />
      </svg>
      {phase === 'idle' ? t('朗读回答') : phase === 'loading' ? t('取消合成') : t('停止朗读')}
    </button>
    {phase === 'playing' && <button type="button" className="muted py-1 hover:underline" onClick={() => audio.current?.pause()}>{t('暂停朗读')}</button>}
    {(phase === 'ready' || phase === 'paused') && <button type="button" className="text-brand-500 py-1 hover:underline" onClick={() => void playPrepared(generation.current)}>
      {phase === 'ready' ? t('播放朗读') : t('继续朗读')}
    </button>}
    {phase !== 'idle' && <span className="muted" role="status">{phase === 'loading' ? t('正在合成语音…') : t('第 {n} / {total} 段', { n: part, total: chunks.length })}</span>}
    {error && <span className="basis-full text-red-500" role="status">{error}</span>}
  </div>;
}
