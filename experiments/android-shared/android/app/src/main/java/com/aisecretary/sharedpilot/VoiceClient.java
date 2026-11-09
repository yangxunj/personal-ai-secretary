package com.aisecretary.sharedpilot;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.InputType;
import android.util.Base64;
import android.widget.EditText;
import android.widget.ArrayAdapter;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;

/** Native-only credentials and narrowly scoped DashScope voice transport. */
final class VoiceClient implements AutoCloseable {
    interface Callback { void complete(String id, String json); void settingsChanged(); }
    private static final String ALIAS = "secretary-pilot-voice";
    private static final int MAX_WAV = 44 + 16000 * 60 * 2;
    private static final int MAX_AUDIO = 20 * 1024 * 1024;
    private final Activity activity;
    private final SharedPreferences prefs;
    private final Callback callback;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicReference<Pending> active = new AtomicReference<>();
    private volatile boolean foreground = true, closed;
    private static final class Pending {
        final String id;
        Pending(String id) { this.id = id; }
        volatile boolean cancelled;
        volatile HttpsURLConnection connection;
    }

    VoiceClient(Activity activity, Callback callback) {
        this.activity = activity; this.callback = callback;
        prefs = activity.getSharedPreferences("voice-settings", Context.MODE_PRIVATE);
    }
    boolean hasKey() { return prefs.contains("ciphertext"); }
    void foreground(boolean value) { foreground = value; if (!value) cancel(); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    private void saveKey(String value, String region) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String encrypted = Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!prefs.edit().putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString("ciphertext", encrypted).putString("region", region).commit()) throw new IllegalStateException();
    }
    private String loadKey() throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(prefs.getString("ciphertext", ""), Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    void showSettings() {
        activity.runOnUiThread(() -> {
            if (closed || !foreground || activity.isFinishing() || active.get() != null) return;
            EditText input = new EditText(activity);
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            input.setHint(hasKey() ? "留空保留已有密钥" : "填写阿里云百炼 API Key"); input.setSingleLine(true);
            String[] regions = {"北京", "新加坡"};
            int initial = "intl".equals(prefs.getString("region", "cn")) ? 1 : 0;
            LinearLayout form = new LinearLayout(activity); form.setOrientation(LinearLayout.VERTICAL);
            int pad = Math.round(20 * activity.getResources().getDisplayMetrics().density);
            form.setPadding(pad, 0, pad, 0);
            TextView description = new TextView(activity);
            description.setText("语音识别和朗读使用阿里云百炼，可能产生费用。密钥加密存于本机，请选择密钥所属区域。");
            Spinner regionChoice = new Spinner(activity);
            regionChoice.setAdapter(new ArrayAdapter<>(activity, android.R.layout.simple_spinner_dropdown_item, regions));
            regionChoice.setSelection(initial);
            form.addView(description); form.addView(regionChoice); form.addView(input);
            AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("语音服务设置")
                    .setView(form).setNegativeButton("取消", null)
                    .setNeutralButton("清除密钥", (d, which) -> { if (prefs.edit().clear().commit()) callback.settingsChanged(); })
                    .setPositiveButton("保存", null).create();
            dialog.setOnShowListener(unused -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
                String value = input.getText().toString().trim(), region = regionChoice.getSelectedItemPosition() == 1 ? "intl" : "cn";
                try {
                    if (value.isEmpty()) {
                        if (!hasKey()) { input.setError("请填写密钥"); return; }
                        if (!prefs.edit().putString("region", region).commit()) throw new IllegalStateException();
                    } else {
                        if (value.length() < 8 || value.length() > 512 || value.matches(".*\\s.*")) { input.setError("请检查密钥格式"); return; }
                        saveKey(value, region);
                    }
                    input.getText().clear(); dialog.dismiss(); callback.settingsChanged();
                } catch (Exception error) { input.setError("保存失败，请重试"); }
            }));
            dialog.show();
        });
    }
    static boolean validWav(byte[] bytes) {
        if (bytes == null || bytes.length < 8044 || bytes.length > MAX_WAV) return false;
        ByteBuffer b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        return tag(bytes, 0, "RIFF") && tag(bytes, 8, "WAVE") && tag(bytes, 12, "fmt ") && tag(bytes, 36, "data")
                && b.getInt(4) == bytes.length - 8 && b.getInt(16) == 16 && b.getShort(20) == 1
                && b.getShort(22) == 1 && b.getInt(24) == 16000 && b.getInt(28) == 32000
                && b.getShort(32) == 2 && b.getShort(34) == 16 && b.getInt(40) == bytes.length - 44 && (bytes.length - 44) % 2 == 0;
    }
    private static boolean tag(byte[] bytes, int offset, String value) {
        if (bytes.length < offset + value.length()) return false;
        for (int i = 0; i < value.length(); i++) if (bytes[offset + i] != value.charAt(i)) return false;
        return true;
    }
    static URL trustedAudioUrl(String value) throws Exception {
        URI uri = new URI(value);
        String host = uri.getHost();
        if (value.length() > 8192 || host == null || uri.getUserInfo() != null || uri.getPort() != -1
                || !("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                || !host.matches("dashscope-result-[a-z0-9-]+\\.oss-[a-z0-9-]+\\.aliyuncs\\.com")) throw new IllegalArgumentException();
        return new URL("https", host, uri.getRawPath() + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()));
    }
    void start(String id, String kind, String payload) {
        if (id == null || !id.matches("[a-zA-Z0-9_-]{1,80}")) return;
        if (closed || !foreground || !hasKey()) { callback.complete(id, failure("请先在设置中配置语音服务。")); return; }
        Pending pending = new Pending(id);
        if (!active.compareAndSet(null, pending)) { callback.complete(id, failure("语音服务正在处理，请稍候。")); return; }
        executor.execute(() -> {
            String result;
            try {
                if (payload == null || payload.length() > 3_000_000) throw new IllegalArgumentException();
                String region = prefs.getString("region", "cn");
                String host = "intl".equals(region) ? "dashscope-intl.aliyuncs.com" : "dashscope.aliyuncs.com";
                JSONObject body;
                if ("asr".equals(kind)) {
                    byte[] wav = Base64.decode(payload, Base64.NO_WRAP);
                    if (!validWav(wav)) throw new IllegalArgumentException();
                    body = new JSONObject().put("model", "qwen3-asr-flash").put("stream", false)
                            .put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", new JSONArray().put(
                                    new JSONObject().put("type", "input_audio").put("input_audio", new JSONObject().put("data", "data:audio/wav;base64," + payload))))))
                            .put("asr_options", new JSONObject().put("enable_itn", true));
                    JSONObject data = new JSONObject(new String(post(pending, "https://" + host + "/compatible-mode/v1/chat/completions", body), StandardCharsets.UTF_8));
                    Object value = data.getJSONArray("choices").getJSONObject(0).getJSONObject("message").get("content");
                    if (!(value instanceof String) || ((String) value).length() > 12000) throw new IllegalArgumentException();
                    result = success(((String) value).trim());
                } else if ("tts".equals(kind)) {
                    String text = payload.trim();
                    if (text.isEmpty() || text.length() > 500) throw new IllegalArgumentException();
                    body = new JSONObject().put("model", "qwen3-tts-flash").put("input", new JSONObject().put("text", text).put("voice", "Cherry").put("language_type", "Auto"));
                    JSONObject data = new JSONObject(new String(post(pending, "https://" + host + "/api/v1/services/aigc/multimodal-generation/generation", body), StandardCharsets.UTF_8));
                    URL audioUrl = trustedAudioUrl(data.getJSONObject("output").getJSONObject("audio").getString("url"));
                    byte[] wav = getAudio(pending, audioUrl);
                    if (wav.length <= 44 || !tag(wav, 0, "RIFF") || !tag(wav, 8, "WAVE")) throw new IllegalArgumentException();
                    result = success(Base64.encodeToString(wav, Base64.NO_WRAP));
                } else throw new IllegalArgumentException();
                if (pending.cancelled) throw new InterruptedException();
            } catch (Exception error) {
                result = failure(pending.cancelled ? "语音请求已取消。" : "语音服务未完成，请检查密钥、区域、额度和网络。");
            } finally { if (pending.connection != null) pending.connection.disconnect(); active.compareAndSet(pending, null); }
            callback.complete(id, result);
        });
    }
    private HttpsURLConnection connect(Pending pending, URL url) throws Exception {
        if (pending.cancelled || !foreground || closed) throw new InterruptedException();
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        pending.connection = connection;
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(60000);
        if (pending.cancelled) { connection.disconnect(); throw new InterruptedException(); }
        return connection;
    }
    private byte[] post(Pending pending, String url, JSONObject body) throws Exception {
        HttpsURLConnection connection = connect(pending, new URL(url));
        connection.setRequestMethod("POST"); connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json"); connection.setRequestProperty("Authorization", "Bearer " + loadKey());
        try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
        if (connection.getResponseCode() != 200) throw new IllegalStateException();
        try (InputStream input = connection.getInputStream()) { return read(pending, input, 1024 * 1024); }
        finally { connection.disconnect(); }
    }
    private byte[] getAudio(Pending pending, URL url) throws Exception {
        HttpsURLConnection connection = connect(pending, url);
        if (connection.getResponseCode() != 200 || connection.getContentLengthLong() > MAX_AUDIO) throw new IllegalStateException();
        try (InputStream input = connection.getInputStream()) { return read(pending, input, MAX_AUDIO); }
        finally { connection.disconnect(); }
    }
    private byte[] read(Pending pending, InputStream input, int max) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) {
            if (pending.cancelled || output.size() + count > max) throw new InterruptedException();
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }
    void cancel() { Pending pending = active.get(); if (pending != null) { pending.cancelled = true; if (pending.connection != null) pending.connection.disconnect(); } }
    void cancel(String id) { Pending pending = active.get(); if (pending != null && pending.id.equals(id)) { pending.cancelled = true; if (pending.connection != null) pending.connection.disconnect(); } }
    @Override public void close() { closed = true; cancel(); executor.shutdownNow(); }
    private static String success(String data) throws Exception { return new JSONObject().put("ok", true).put("data", data).toString(); }
    private static String failure(String message) { try { return new JSONObject().put("ok", false).put("error", message).toString(); } catch (Exception error) { return "{\"ok\":false}"; } }
}
