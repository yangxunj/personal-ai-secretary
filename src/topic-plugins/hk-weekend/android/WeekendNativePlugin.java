package com.aisecretary.sharedpilot;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import org.json.JSONObject;

/** Plugin-owned Android transport and cache. Uses the existing cache namespace. */
final class WeekendNativePlugin implements TopicNativePlugin {
    private static final String ID = "hk-weekend";
    private final Activity activity;
    private final WeekendClient client;
    WeekendNativePlugin(Activity activity, Callback callback) {
        this.activity = activity;
        client = new WeekendClient((id, response) -> callback.complete(ID, id, response));
    }
    @Override public String id() { return ID; }
    @Override public void request(String id, String query) { client.fetch(id, query); }
    @Override public String readCache() { return activity.getSharedPreferences("weekend-cache", Activity.MODE_PRIVATE).getString("result", ""); }
    @Override public boolean writeCache(String json) {
        if (json == null || json.length() > 2_000_000) return false;
        try {
            JSONObject data = new JSONObject(json);
            if (!data.has("saturday") || !data.has("sunday") || !data.has("rows") || !data.has("reports")) return false;
            return activity.getSharedPreferences("weekend-cache", Activity.MODE_PRIVATE).edit().putString("result", json).commit();
        } catch (Exception error) { return false; }
    }
    @Override public void openLink(String value) {
        if (value == null || value.length() > 2048) return;
        try {
            Uri uri = Uri.parse(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) return;
            activity.runOnUiThread(() -> { try { activity.startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { } });
        } catch (Exception ignored) { }
    }
    @Override public void close() { client.close(); }
}
