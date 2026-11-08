package com.aisecretary.sharedpilot;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

/** Read-only fixed-source adapter. Business parsing remains in shared JavaScript. */
final class WeekendClient implements AutoCloseable {
    interface Callback { void complete(String id, String response); }
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private final Callback callback;
    private volatile boolean closed;
    WeekendClient(Callback callback) { this.callback = callback; }

    void fetch(String id, String request) {
        if (closed || id == null || !id.matches("[a-zA-Z0-9_-]{1,80}") || request == null || request.length() > 500) return;
        executor.execute(() -> {
            String result;
            try {
                JSONObject query = new JSONObject(request);
                String source = query.getString("source"), address;
                if (source.equals("hktb")) address = "https://www.discoverhongkong.com/tc/events.html";
                else if (source.equals("lcsdm")) address = "https://www.museums.gov.hk/calendar_data/exhibitions_data.txt";
                else if (source.equals("hkpl")) {
                    int year = query.getInt("year"), month = query.getInt("month"), page = query.getInt("page");
                    if (year < 2020 || year > 2100 || month < 1 || month > 12 || page < 1 || page > 45) throw new IllegalArgumentException();
                    address = "https://www.hkpl.gov.hk/tc/extension-activities/all-events/search?dist_id=&lib_id=0&cat_id=0&year=" + year + "&month=" + month + (page > 1 ? "&page=" + page : "");
                } else throw new IllegalArgumentException();
                result = new JSONObject().put("ok", true).put("data", read(new URL(address))).toString();
            } catch (Exception error) {
                result = "{\"ok\":false,\"error\":\"来源暂时无法读取\"}";
            }
            if (!closed) callback.complete(id, result);
        });
    }
    private String read(URL url) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(20000); connection.setReadTimeout(30000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36");
        connection.setRequestProperty("Accept-Language", "zh-HK,zh;q=0.9");
        try {
            if (connection.getResponseCode() != 200) throw new IllegalStateException();
            try (InputStream stream = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int n, total = 0;
                while ((n = stream.read(buffer)) != -1) { total += n; if (total > 8 * 1024 * 1024) throw new IllegalStateException(); out.write(buffer, 0, n); }
                return new String(out.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally { connection.disconnect(); }
    }
    @Override public void close() { closed = true; executor.shutdownNow(); }
}
