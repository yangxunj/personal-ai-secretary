package com.aisecretary.sharedpilot;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.DatabaseUtils;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** SQLite adapter for the shared task policy; never interprets model instructions. */
final class TaskStore {
    static void createTable(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, category TEXT NOT NULL, priority INTEGER NOT NULL, due_date TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1)");
    }
    private static ContentValues columns(JSONObject data) throws Exception {
        ContentValues row = new ContentValues(); row.put("data", data.toString());
        row.put("title", data.getString("title")); row.put("status", data.getString("status"));
        row.put("category", data.getString("category")); row.put("priority", data.getInt("priority"));
        if (data.isNull("dueDate")) row.putNull("due_date"); else row.put("due_date", data.getString("dueDate"));
        row.put("updated_at", System.currentTimeMillis()); return row;
    }
    private static JSONObject dto(Cursor cursor) throws Exception {
        return new JSONObject(cursor.getString(cursor.getColumnIndexOrThrow("data")))
                .put("id", cursor.getString(cursor.getColumnIndexOrThrow("id")))
                .put("version", cursor.getInt(cursor.getColumnIndexOrThrow("version")));
    }
    static JSONObject read(SQLiteDatabase db, String id) throws Exception {
        try (Cursor cursor = db.query("tasks", null, "id = ?", new String[]{id}, null, null, null)) { return cursor.moveToFirst() ? dto(cursor) : null; }
    }
    static JSONObject create(SQLiteDatabase db, String serialized) throws Exception {
        if (serialized == null || serialized.length() > 100000) throw new IllegalArgumentException("Invalid task payload");
        if (DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM tasks", null) >= 2000) throw new IllegalStateException("Task pilot limit");
        JSONObject data = new JSONObject(serialized); ContentValues row = columns(data);
        String id = UUID.randomUUID().toString(); row.put("id", id); row.put("created_at", row.getAsLong("updated_at"));
        db.insertOrThrow("tasks", null, row); return read(db, id);
    }
    static JSONObject update(SQLiteDatabase db, String id, int expectedVersion, String serialized) throws Exception {
        if (serialized == null || serialized.length() > 100000) throw new IllegalArgumentException("Invalid task patch");
        JSONObject current = read(db, id);
        if (current == null || current.getInt("version") != expectedVersion) throw new RecordStore.StoreError("conflict");
        current.remove("id"); current.remove("version");
        JSONObject patch = new JSONObject(serialized);
        java.util.Iterator<String> keys = patch.keys(); while (keys.hasNext()) { String key = keys.next(); current.put(key, patch.get(key)); }
        ContentValues values = columns(current); values.put("version", expectedVersion + 1);
        if (db.update("tasks", values, "id = ? AND version = ?", new String[]{id, String.valueOf(expectedVersion)}) != 1) throw new RecordStore.StoreError("conflict");
        return read(db, id);
    }
    static JSONArray list(SQLiteDatabase db, String serializedPlan) throws Exception {
        if (serializedPlan == null || serializedPlan.length() > 100000) throw new IllegalArgumentException("Invalid task query");
        JSONObject plan = new JSONObject(serializedPlan); JSONArray statuses = plan.getJSONArray("statuses"); int limit = plan.getInt("limit");
        if (statuses.length() < 1 || statuses.length() > 5 || limit < 1 || limit > 50) throw new IllegalArgumentException("Invalid task query bounds");
        List<String> parts = new ArrayList<>(), parameters = new ArrayList<>();
        List<String> slots = new ArrayList<>(); for (int i = 0; i < statuses.length(); i++) { slots.add("?"); parameters.add(statuses.getString(i)); }
        parts.add("status IN (" + android.text.TextUtils.join(",", slots) + ")");
        if (!plan.isNull("category")) { parts.add("category = ?"); parameters.add(plan.getString("category")); }
        if (!plan.isNull("keyword")) { parts.add("title LIKE ?"); parameters.add("%" + plan.getString("keyword") + "%"); }
        JSONArray result = new JSONArray();
        try (Cursor cursor = db.query("tasks", null, android.text.TextUtils.join(" AND ", parts), parameters.toArray(new String[0]), null, null, "priority ASC, due_date ASC, created_at DESC", String.valueOf(limit))) {
            while (cursor.moveToNext()) result.put(dto(cursor));
        }
        return result;
    }
}
