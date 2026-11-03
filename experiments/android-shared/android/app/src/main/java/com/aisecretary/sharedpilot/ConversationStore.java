package com.aisecretary.sharedpilot;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.DatabaseUtils;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;

/** Platform persistence for versioned Pi conversation snapshots. No model/key access. */
final class ConversationStore {
    static void createTable(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE conversations (id TEXT PRIMARY KEY, mode TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    }
    private static void mode(String mode) {
        if (!"deepseek".equals(mode) && !"demo".equals(mode)) throw new IllegalArgumentException("Invalid conversation mode");
    }
    static JSONArray list(SQLiteDatabase db, String mode) throws Exception {
        mode(mode); JSONArray result = new JSONArray();
        try (Cursor cursor = db.query("conversations", new String[]{"id", "title"}, "mode = ?", new String[]{mode}, null, null, "updated_at DESC, id ASC", "20")) {
            while (cursor.moveToNext()) result.put(new JSONObject().put("id", cursor.getString(0)).put("title", cursor.getString(1)));
        }
        return result;
    }
    static JSONObject read(SQLiteDatabase db, String id) throws Exception {
        if (id == null || !id.matches("[a-zA-Z0-9_-]{1,80}")) throw new IllegalArgumentException("Invalid conversation id");
        try (Cursor cursor = db.query("conversations", new String[]{"data", "version"}, "id = ?", new String[]{id}, null, null, null)) {
            return cursor.moveToFirst() ? new JSONObject().put("snapshot", new JSONObject(cursor.getString(0))).put("version", cursor.getInt(1)) : null;
        }
    }
    static JSONObject save(SQLiteDatabase db, String id, int expectedVersion, String serialized) throws Exception {
        if (serialized == null || serialized.length() > 240000 || expectedVersion < 0) throw new IllegalArgumentException("Invalid conversation snapshot");
        JSONObject snapshot = new JSONObject(serialized); String mode = snapshot.getString("mode"); mode(mode);
        if (snapshot.getInt("schemaVersion") != 1 || !id.equals(snapshot.getString("id"))) throw new IllegalArgumentException("Invalid conversation snapshot");
        String title = snapshot.getString("title"); if (title.length() > 80) throw new IllegalArgumentException("Invalid conversation title");
        JSONObject before = read(db, id);
        if ((before == null ? 0 : before.getInt("version")) != expectedVersion) throw new RecordStore.StoreError("conflict");
        if (before != null && !mode.equals(before.getJSONObject("snapshot").getString("mode"))) throw new IllegalArgumentException("Conversation mode changed");
        ContentValues values = new ContentValues(); values.put("mode", mode); values.put("title", title); values.put("data", serialized);
        values.put("version", expectedVersion + 1); values.put("updated_at", System.currentTimeMillis());
        if (before == null) {
            if (DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM conversations WHERE mode = ?", new String[]{mode}) >= 20) throw new IllegalStateException("Conversation pilot limit");
            values.put("id", id); db.insertOrThrow("conversations", null, values);
        } else if (db.update("conversations", values, "id = ? AND version = ?", new String[]{id, String.valueOf(expectedVersion)}) != 1) throw new RecordStore.StoreError("conflict");
        return read(db, id);
    }
}
