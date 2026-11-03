package com.aisecretary.sharedpilot;

import android.app.Activity;
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

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        store = new RecordStore(this);
        webView = new WebView(this);
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

    private static boolean trusted(Uri url) {
        return "https".equals(url.getScheme()) && ORIGIN.equals(url.getHost())
                && url.getPort() == -1 && url.getPath() != null && url.getPath().startsWith("/assets/");
    }

    private final class StorageBridge {
        @JavascriptInterface public String listRecords() {
            try { return new JSONObject().put("ok", true).put("data", store.list()).toString(); }
            catch (Exception error) { return failure(); }
        }
        @JavascriptInterface public String appendRecord(String values) {
            try { return new JSONObject().put("ok", true).put("data", store.append(values)).toString(); }
            catch (Exception error) { return failure(); }
        }
        private String failure() { return "{\"ok\":false,\"error\":\"本地存储操作失败，请重试；已填写内容仍保留。\"}"; }
    }

    @Override protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("SecretaryStorage");
            webView.destroy();
        }
        // Close after WebView teardown; SQLiteOpenHelper will reopen if an in-flight bridge needs it.
        if (store != null) store.close();
        super.onDestroy();
    }
}
