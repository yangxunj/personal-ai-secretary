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
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

/** Native-only credentials and fixed-host transport. The WebView never reads the key. */
final class DeepSeekClient implements AutoCloseable {
    interface Callback { void complete(String id, String json); void settingsChanged(); }
    private static final String ALIAS = "secretary-pilot-deepseek";
    private final Activity activity;
    private final SharedPreferences preferences;
    private final Callback callback;
    private final boolean titleOnly;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicReference<Pending> active = new AtomicReference<>();
    private volatile boolean foreground = true;
    private volatile boolean closed;
    private static final class Pending {
        final String id;
        volatile boolean cancelled;
        volatile HttpsURLConnection connection;
        Pending(String id) { this.id = id; }
    }

    DeepSeekClient(Activity activity, Callback callback) {
        this(activity, callback, false);
    }
    DeepSeekClient(Activity activity, Callback callback, boolean titleOnly) {
        this.activity = activity; this.callback = callback;
        this.titleOnly = titleOnly;
        preferences = activity.getSharedPreferences("model-settings", Context.MODE_PRIVATE);
    }
    boolean hasKey() { return preferences.contains("ciphertext"); }
    void foreground(boolean value) { foreground = value; if (!value) cancel(); }
    static boolean isPublicWebUrl(String value) {
        try {
            java.net.URI uri = new java.net.URI(value); String host = uri.getHost();
            return value.length() <= 8192 && host != null && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) && uri.getUserInfo() == null && uri.getPort() == -1 && host.contains(".") && !host.matches("[0-9.]+") && !host.contains(":") && !host.toLowerCase(java.util.Locale.ROOT).matches(".*(^|\\.)(localhost|local|internal|lan|home|test|invalid)\\.?$");
        } catch (Exception ignored) { return false; }
    }

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
    private void save(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String encrypted = Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!preferences.edit().putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).putString("ciphertext", encrypted).commit()) throw new IllegalStateException("Key save failed");
    }
    private String load() throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(preferences.getString("iv", ""), Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(preferences.getString("ciphertext", ""), Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    void showSettings() {
        activity.runOnUiThread(() -> {
            if (closed || activity.isFinishing()) return;
            EditText input = new EditText(activity);
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            input.setHint(hasKey() ? "留空保留已有密钥" : "填写你自己的 DeepSeek API Key");
            input.setSingleLine(true);
            AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("DeepSeek API Key")
                    .setMessage("密钥只在安卓原生层加密保存，不显示给网页或写入聊天。留空不会清除已有密钥。")
                    .setView(input).setNegativeButton("取消", null).setNeutralButton("清除密钥", (d, w) -> {
                        if (preferences.edit().clear().commit()) callback.settingsChanged();
                        else android.widget.Toast.makeText(activity, "清除失败，请重试", android.widget.Toast.LENGTH_LONG).show();
                    }).setPositiveButton("保存", null).create();
            dialog.setOnShowListener(unused -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
                String value = input.getText().toString().trim();
                if (value.isEmpty()) { dialog.dismiss(); return; }
                if (value.length() < 16 || value.length() > 512 || value.matches(".*\\s.*")) { input.setError("请检查密钥格式"); return; }
                try { save(value); input.getText().clear(); dialog.dismiss(); callback.settingsChanged(); }
                catch (Exception error) { input.setError("保存失败，输入仍保留，请重试"); }
            }));
            dialog.show();
        });
    }

    void start(String id, String payload) {
        startRequest(id, payload, "chat");
    }
    void startWeb(String id, String kind, String payload) {
        if (!"search".equals(kind) && !"fetch".equals(kind)) { callback.complete(id, failure("不支持的联网工具。")); return; }
        startRequest(id, payload, kind);
    }
    private void startRequest(String id, String payload, String kind) {
        if (id == null || !id.matches("[a-zA-Z0-9:_.-]{1,100}")) return;
        if (closed || !foreground) { callback.complete(id, failure("应用已离开前台，请重新打开后再试。")); return; }
        Pending request = new Pending(id);
        if (!active.compareAndSet(null, request)) { callback.complete(id, failure("已有模型请求正在进行。")); return; }
        executor.execute(() -> {
            String result;
            try {
                if (payload == null || payload.length() > 60000 || !hasKey()) throw new IllegalArgumentException("请先配置 DeepSeek 密钥，或使用离线演练。");
                JSONObject body = new JSONObject(payload);
                if ("chat".equals(kind)) {
                    if (!"deepseek-flash".equals(body.optString("model")) || body.optBoolean("stream", true)) throw new IllegalArgumentException("本包仅支持非流式 DeepSeek Flash 请求。");
                    body.put("max_tokens", titleOnly ? 128 : 2048);
                } else if ("search".equals(kind)) {
                    String query = body.optString("query", "").trim(); int count = body.optInt("count", 0);
                    if (query.isEmpty() || query.length() > 128 || count < 1 || count > 5) throw new IllegalArgumentException("搜索参数无效。");
                    body = new JSONObject().put("query", query).put("count", count).put("need_content", false);
                } else {
                    String value = body.optString("url", "");
                    if (!isPublicWebUrl(value)) throw new IllegalArgumentException("仅支持公开网页地址。");
                    body = new JSONObject().put("url", value);
                }
                if (request.cancelled) throw new InterruptedException();
                HttpsURLConnection connection = (HttpsURLConnection) new URL("https://api.deepseek.com/" + ("chat".equals(kind) ? "chat/completions" : "v1/tools/" + kind)).openConnection();
                request.connection = connection;
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(60000);
                connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Authorization", "Bearer " + load());
                if (request.cancelled) throw new InterruptedException();
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
                int status = connection.getResponseCode();
                if (status != 200) throw new IllegalArgumentException("DeepSeek " + ("chat".equals(kind) ? "对话" : "联网工具") + "返回 HTTP " + status + "；请检查密钥、额度与网络。");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                try (InputStream stream = connection.getInputStream()) {
                    byte[] buffer = new byte[8192]; int read;
                    while ((read = stream.read(buffer)) != -1) {
                        if (request.cancelled || bytes.size() + read > ("chat".equals(kind) ? 512000 : 2097152)) throw new InterruptedException();
                        bytes.write(buffer, 0, read);
                    }
                }
                if (request.cancelled) throw new InterruptedException();
                JSONObject response = new JSONObject(bytes.toString("UTF-8"));
                result = new JSONObject().put("ok", true).put("data", "chat".equals(kind) ? new JSONObject().put("choices", response.getJSONArray("choices")) : response).toString();
            } catch (IllegalArgumentException error) { result = failure(error.getMessage()); }
            catch (Exception error) { result = failure(request.cancelled ? "本轮已取消，请先检查已保存记录。" : "模型连接失败，请检查网络或重新配置密钥。已保存记录保留。"); }
            finally { if (request.connection != null) request.connection.disconnect(); active.compareAndSet(request, null); }
            callback.complete(id, result);
        });
    }
    void cancel() {
        Pending request = active.get();
        if (request != null) { request.cancelled = true; if (request.connection != null) request.connection.disconnect(); }
    }
    private static String failure(String message) {
        try { return new JSONObject().put("ok", false).put("error", message).toString(); }
        catch (Exception error) { return "{\"ok\":false,\"error\":\"模型连接失败\"}"; }
    }
    @Override public void close() { closed = true; cancel(); executor.shutdown(); }
}
