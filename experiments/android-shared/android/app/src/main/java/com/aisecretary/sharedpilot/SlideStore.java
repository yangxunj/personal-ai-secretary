package com.aisecretary.sharedpilot;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;

/** Local slide data only: Markdown is data, never executable code. */
final class SlideStore {
    static void createTable(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE slides (id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL, created_at INTEGER NOT NULL)");
    }
    static JSONObject create(SQLiteDatabase db, String serialized) throws Exception {
        if (serialized == null || serialized.length() > 30000) throw new IllegalArgumentException();
        JSONObject value = new JSONObject(serialized);
        if (value.length() != 2 || !(value.opt("title") instanceof String) || !(value.opt("markdown") instanceof String)) throw new IllegalArgumentException();
        String title = value.getString("title").trim(), markdown = value.getString("markdown").trim();
        if (title.isEmpty() || title.length() > 100 || markdown.isEmpty() || markdown.length() > 12000) throw new IllegalArgumentException();
        String id = UUID.randomUUID().toString();
        ContentValues row = new ContentValues(); row.put("id", id); row.put("title", title); row.put("markdown", markdown); row.put("created_at", System.currentTimeMillis());
        db.insertOrThrow("slides", null, row);
        return new JSONObject().put("id", id).put("title", title);
    }
    static JSONArray list(SQLiteDatabase db) throws Exception {
        JSONArray rows = new JSONArray();
        try (Cursor cursor = db.query("slides", new String[]{"id", "title", "created_at"}, null, null, null, null, "created_at DESC")) {
            while (cursor.moveToNext()) rows.put(new JSONObject().put("id", cursor.getString(0)).put("title", cursor.getString(1)).put("createdAt", cursor.getLong(2)));
        }
        return rows;
    }
    static JSONObject read(SQLiteDatabase db, String id) throws Exception {
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException();
        try (Cursor cursor = db.query("slides", new String[]{"id", "title", "markdown", "created_at"}, "id = ?", new String[]{id}, null, null, null)) {
            if (!cursor.moveToFirst()) return null;
            return new JSONObject().put("id", cursor.getString(0)).put("title", cursor.getString(1)).put("markdown", cursor.getString(2)).put("createdAt", cursor.getLong(3));
        }
    }
}
