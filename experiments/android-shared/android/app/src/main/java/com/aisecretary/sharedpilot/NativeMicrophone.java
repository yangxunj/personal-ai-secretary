package com.aisecretary.sharedpilot;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;

/** Foreground-only PCM capture for WebViews that cannot open getUserMedia. */
final class NativeMicrophone implements AutoCloseable {
    interface Callback { void event(String id, String type, String payload); }
    private static final int RATE = 16000;
    private static final int SAMPLES = 1600;
    private final Activity activity;
    private final Callback callback;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicReference<Session> active = new AtomicReference<>();
    private volatile boolean foreground = true, closed;
    private static final class Session {
        final String id;
        volatile boolean stopped, listening;
        volatile AudioRecord recorder;
        final AtomicBoolean framePending = new AtomicBoolean();
        volatile long pendingSince;
        Session(String id) { this.id = id; }
    }
    NativeMicrophone(Activity activity, Callback callback) { this.activity = activity; this.callback = callback; }
    void foreground(boolean value) { foreground = value; if (!value) stop(); }
    void start(String id) {
        if (id == null || !id.matches("[a-zA-Z0-9_-]{1,80}")) return;
        if (closed || !foreground || activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            callback.event(id, "error", "麦克风权限不可用，请检查系统设置。"); return;
        }
        Session session = new Session(id);
        if (!active.compareAndSet(null, session)) { callback.event(id, "error", "麦克风正在使用或释放，请稍后重试。"); return; }
        worker.execute(() -> capture(session));
    }
    private void capture(Session session) {
        AudioRecord recorder = null;
        try {
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (min <= 0) throw new IllegalStateException();
            for (int attempt = 0; attempt < 2 && recorder == null; attempt++) {
                if (attempt > 0) Thread.sleep(300); // Allow a failed WebView capture to release its device.
                for (int source : new int[]{MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC}) {
                    if (session.stopped || !foreground || closed) throw new InterruptedException();
                    try {
                        recorder = new AudioRecord(source, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, SAMPLES * 4));
                        session.recorder = recorder;
                        if (recorder.getState() == AudioRecord.STATE_INITIALIZED) {
                            recorder.startRecording();
                            if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) break;
                        }
                    } catch (RuntimeException ignored) { /* Try the standard microphone source. */ }
                    if (recorder != null) recorder.release();
                    recorder = null; session.recorder = null;
                }
            }
            if (recorder == null) throw new IllegalStateException();
            if (session.stopped || !foreground || closed) throw new InterruptedException();
            callback.event(session.id, "ready", "16000");
            short[] samples = new short[SAMPLES];
            while (!session.stopped && foreground && !closed) {
                int count = recorder.read(samples, 0, samples.length);
                if (count <= 0) { if (!session.stopped) throw new IllegalStateException(); break; }
                if (!session.listening) continue;
                if (!session.framePending.compareAndSet(false, true)) {
                    if (android.os.SystemClock.elapsedRealtime() - session.pendingSince > 3000) throw new IllegalStateException();
                    continue;
                }
                session.pendingSince = android.os.SystemClock.elapsedRealtime();
                byte[] pcm = new byte[count * 2];
                for (int i = 0; i < count; i++) { pcm[i * 2] = (byte) samples[i]; pcm[i * 2 + 1] = (byte) (samples[i] >> 8); }
                if (!session.stopped && session.listening && foreground && !closed) callback.event(session.id, "audio", Base64.encodeToString(pcm, Base64.NO_WRAP));
                else session.framePending.set(false);
            }
        } catch (Exception error) {
            if (!session.stopped && foreground && !closed) callback.event(session.id, "error", "安卓原生录音启动或读取失败，请检查麦克风后重试。");
        } finally {
            session.stopped = true; session.listening = false;
            if (recorder != null) { try { recorder.stop(); } catch (Exception ignored) {} recorder.release(); }
            session.recorder = null; active.compareAndSet(session, null);
        }
    }
    void listening(String id, boolean value) { Session session = active.get(); if (session != null && session.id.equals(id) && !session.stopped) session.listening = value; }
    void acknowledge(String id) { Session session = active.get(); if (session != null && session.id.equals(id)) session.framePending.set(false); }
    void stop(String id) { Session session = active.get(); if (session != null && session.id.equals(id)) stop(session); }
    private void stop() { Session session = active.get(); if (session != null) stop(session); }
    private void stop(Session session) {
        session.stopped = true; session.listening = false;
        AudioRecord recorder = session.recorder;
        if (recorder != null) try { recorder.stop(); } catch (Exception ignored) {}
    }
    @Override public void close() { closed = true; stop(); worker.shutdownNow(); }
}
