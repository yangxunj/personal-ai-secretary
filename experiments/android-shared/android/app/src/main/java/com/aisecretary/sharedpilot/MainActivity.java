package com.aisecretary.sharedpilot;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "appassets.androidplatform.net";
    private WebView webView;
    private RecordStore store;
    private DeepSeekClient modelClient;
    private WeekendClient weekendClient;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        store = new RecordStore(this);
        webView = new WebView(this);
        weekendClient = new WeekendClient((id, response) -> runScript("window.SecretaryWeekend && window.SecretaryWeekend.receive(" + quote(id) + "," + quote(response) + ")"));
        modelClient = new DeepSeekClient(this, new DeepSeekClient.Callback() {
            @Override public void complete(String id, String json) {
                runScript("window.SecretaryAI && window.SecretaryAI.receive(" + quote(id) + "," + quote(json) + ")");
            }
            @Override public void settingsChanged() {
                runScript("window.SecretaryAI && window.SecretaryAI.settingsChanged()");
            }
        });
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !trusted(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = trusted(request.getUrl()) ? assets.shouldInterceptRequest(request.getUrl()) : null;
                if (response != null) return response;
                // Never fall through to networking, even on a missing bundled asset.
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        // Only trusted, bundled pages can load; frames and remote navigation are blocked.
        webView.addJavascriptInterface(new StorageBridge(), "SecretaryStorage");
        setContentView(webView);
        webView.loadUrl("https://" + ORIGIN + "/assets/index.html");
    }

    private static String quote(String value) {
        return JSONObject.quote(value).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
    }
    private void runScript(String script) {
        WebView view = webView;
        if (view != null) view.post(() -> { if (webView != null && !isFinishing()) webView.evaluateJavascript(script, null); });
    }

    private static boolean trusted(Uri url) {
        return "https".equals(url.getScheme()) && ORIGIN.equals(url.getHost())
                && url.getPort() == -1 && url.getPath() != null && url.getPath().startsWith("/assets/");
    }

    private final class StorageBridge {
        @JavascriptInterface public String readOwners() {
            try {
                org.json.JSONArray names = new OwnerStore(getSharedPreferences("pilot-settings", MODE_PRIVATE)).read();
                return new JSONObject().put("ok", true).put("data", names == null ? JSONObject.NULL : names).toString();
            } catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String writeOwners(String serialized) {
            try {
                return new JSONObject().put("ok", true).put("data", new OwnerStore(getSharedPreferences("pilot-settings", MODE_PRIVATE)).write(serialized)).toString();
            } catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String listConversations(String mode) {
            try { return new JSONObject().put("ok", true).put("data", store.listConversations(mode)).toString(); }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String readConversation(String id) {
            try { JSONObject result = store.readConversation(id); return new JSONObject().put("ok", true).put("data", result == null ? JSONObject.NULL : result).toString(); }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String saveConversation(String id, int version, String data) {
            try { return new JSONObject().put("ok", true).put("data", store.saveConversation(id, version, data)).toString(); }
            catch (RecordStore.StoreError error) { return "{\"ok\":false,\"code\":\"conflict\"}"; }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String listTasks(String plan) {
            try { return new JSONObject().put("ok", true).put("data", store.listTasks(plan)).toString(); }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String listTasksForView() {
            try { return new JSONObject().put("ok", true).put("data", store.listTasksForView()).toString(); }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String readTask(String id) {
            try { JSONObject task = store.readTask(id); return new JSONObject().put("ok", true).put("data", task == null ? JSONObject.NULL : task).toString(); }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String createTask(String data) {
            try { return new JSONObject().put("ok", true).put("data", store.writeTask(data, null, 0)).toString(); }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String updateTask(String id, int version, String patch) {
            try { return new JSONObject().put("ok", true).put("data", store.writeTask(patch, id, version)).toString(); }
            catch (RecordStore.StoreError error) { return "{\"ok\":false,\"code\":\"conflict\"}"; }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public boolean hasApiKey() { return modelClient.hasKey(); }
        @JavascriptInterface public void openModelSettings() { modelClient.showSettings(); }
        @JavascriptInterface public void beginModelRequest(String id, String payload) { modelClient.start(id, payload); }
        @JavascriptInterface public void cancelModelRequest() { modelClient.cancel(); }
        @JavascriptInterface public void fetchWeekendSource(String id, String query) { weekendClient.fetch(id, query); }
        @JavascriptInterface public String readWeekendCache() {
            return getSharedPreferences("weekend-cache", MODE_PRIVATE).getString("result", "");
        }
        @JavascriptInterface public boolean saveWeekendCache(String json) {
            if (json == null || json.length() > 2_000_000) return false;
            try {
                JSONObject data = new JSONObject(json);
                if (!data.has("saturday") || !data.has("sunday") || !data.has("rows") || !data.has("reports")) return false;
                return getSharedPreferences("weekend-cache", MODE_PRIVATE).edit().putString("result", json).commit();
            } catch (Exception error) { return false; }
        }
        @JavascriptInterface public void openWeekendLink(String value) {
            if (value == null || value.length() > 2048) return;
            try {
                Uri uri = Uri.parse(value);
                if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) return;
                runOnUiThread(() -> { try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { } });
            } catch (Exception ignored) { }
        }
        @JavascriptInterface public String listRecords() {
            try { return new JSONObject().put("ok", true).put("data", store.list()).toString(); }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String appendRecord(String values) {
            try { return new JSONObject().put("ok", true).put("data", store.append(values)).toString(); }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String updateRecord(String id, int expectedVersion, String values) {
            try { return new JSONObject().put("ok", true).put("data", store.update(id, expectedVersion, values)).toString(); }
            catch (RecordStore.StoreError error) { return "{\"ok\":false,\"code\":\"conflict\"}"; }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String readToolReceipt(String key, String signature) {
            try { JSONObject receipt = store.receipt(key, signature); return new JSONObject().put("ok", true).put("data", receipt == null ? JSONObject.NULL : receipt).toString(); }
            catch (RecordStore.StoreError error) { return "{\"ok\":false,\"code\":\"conflict\"}"; }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String commitTool(String key, String signature, String operation) {
            try { return new JSONObject().put("ok", true).put("data", store.commitTool(key, signature, operation)).toString(); }
            catch (RecordStore.StoreError error) { return "{\"ok\":false,\"code\":\"conflict\"}"; }
            catch (Exception error) { return failure(); }
        }
        private String failure() { return "{\"ok\":false,\"error\":\"本地存储操作失败，请重试；已填写内容仍保留。\"}"; }
    }

    @Override protected void onStart() { super.onStart(); if (modelClient != null) modelClient.foreground(true); }
    @Override protected void onStop() { if (modelClient != null) modelClient.foreground(false); super.onStop(); }
    @Override protected void onDestroy() {
        if (modelClient != null) modelClient.close();
        if (weekendClient != null) weekendClient.close();
        if (webView != null) {
            webView.removeJavascriptInterface("SecretaryStorage");
            webView.destroy();
            webView = null;
        }
        // Close after WebView teardown; SQLiteOpenHelper will reopen if an in-flight bridge needs it.
        if (store != null) store.close();
        super.onDestroy();
    }
}
