package com.aisecretary.sharedpilot;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.UUID;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Storage adapter only; field rules are executed by the shared TypeScript module. */
final class RecordStore extends SQLiteOpenHelper {
    RecordStore(Context context) { super(context, "shared-pilot.db", null, 4); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE records (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1)");
        createReceipts(db);
        TaskStore.createTable(db);
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        migrate(db, oldVersion, newVersion);
    }

    static void migrate(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion == 1 && newVersion >= 2 && newVersion <= 4) {
            db.execSQL("ALTER TABLE records ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
            if (newVersion >= 3) createReceipts(db);
            if (newVersion == 4) TaskStore.createTable(db);
            return;
        }
        if (oldVersion == 2 && newVersion >= 3 && newVersion <= 4) {
            createReceipts(db);
            if (newVersion == 4) TaskStore.createTable(db);
            return;
        }
        if (oldVersion == 3 && newVersion == 4) {
            TaskStore.createTable(db);
            return;
        }
        // Refuse unknown migrations rather than deleting user records.
        throw new IllegalStateException("Unsupported pilot database version");
    }

    private static void createReceipts(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE tool_receipts (call_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL)");
    }

    private static String fingerprint(String signature) throws Exception {
        if (signature == null || signature.length() > 60000) throw new IllegalArgumentException("Invalid receipt signature");
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(signature.getBytes(StandardCharsets.UTF_8));
        StringBuilder value = new StringBuilder();
        for (byte item : digest) value.append(String.format(java.util.Locale.ROOT, "%02x", item & 255));
        return value.toString();
    }

    synchronized JSONObject receipt(String key, String signature) throws Exception {
        if (key == null || !key.matches("[a-zA-Z0-9:_.-]{1,200}")) throw new IllegalArgumentException("Invalid tool key");
        try (Cursor cursor = getReadableDatabase().query("tool_receipts", new String[]{"request_hash", "result"}, "call_id = ?", new String[]{key}, null, null, null)) {
            if (!cursor.moveToFirst()) return null;
            if (!cursor.getString(0).equals(fingerprint(signature))) throw new StoreError("conflict");
            return new JSONObject(cursor.getString(1));
        }
    }

    synchronized JSONObject commitTool(String key, String signature, String serialized) throws Exception {
        if (serialized == null || serialized.length() > 100000) throw new IllegalArgumentException("Invalid tool operation");
        JSONObject operation = new JSONObject(serialized);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            JSONObject result = receipt(key, signature);
            if (result == null) {
                String values = operation.getJSONObject("values").toString();
                String kind = operation.getString("kind");
                if ("create".equals(kind)) result = append(values);
                else if ("update".equals(kind)) result = update(operation.getString("id"), operation.getInt("expectedVersion"), values);
                else if ("task-create".equals(kind)) result = TaskStore.create(db, values);
                else if ("task-update".equals(kind)) result = TaskStore.update(db, operation.getString("id"), operation.getInt("expectedVersion"), values);
                else throw new IllegalArgumentException("Unknown tool operation");
                ContentValues row = new ContentValues();
                row.put("call_id", key); row.put("request_hash", fingerprint(signature)); row.put("result", result.toString());
                db.insertOrThrow("tool_receipts", null, row);
            }
            db.setTransactionSuccessful();
            return result;
        } finally { db.endTransaction(); }
    }

    synchronized JSONArray listTasks(String plan) throws Exception { return TaskStore.list(getReadableDatabase(), plan); }
    synchronized JSONObject readTask(String id) throws Exception { return TaskStore.read(getReadableDatabase(), id); }
    synchronized JSONObject writeTask(String serialized, String id, int version) throws Exception {
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            JSONObject result = id == null ? TaskStore.create(db, serialized) : TaskStore.update(db, id, version, serialized);
            db.setTransactionSuccessful(); return result;
        } finally { db.endTransaction(); }
    }

    synchronized JSONObject append(String serialized) throws JSONException {
        // Bound bridge input; never accept paths, SQL or executable content.
        if (serialized == null || serialized.length() > 100000) throw new IllegalArgumentException("Invalid storage payload");
        JSONObject data = new JSONObject(serialized);
        String id = UUID.randomUUID().toString();
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues row = new ContentValues();
            row.put("id", id);
            row.put("data", data.toString());
            row.put("created_at", System.currentTimeMillis());
            db.insertOrThrow("records", null, row);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        return new JSONObject().put("id", id).put("values", data).put("version", 1);
    }

    static final class StoreError extends Exception {
        final String code;
        StoreError(String code) { this.code = code; }
    }

    synchronized JSONObject update(String id, int expectedVersion, String serialized) throws Exception {
        if (id == null || id.length() > 100 || serialized == null || serialized.length() > 100000) throw new IllegalArgumentException("Invalid storage payload");
        JSONObject data = new JSONObject(serialized);
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues patch = new ContentValues();
            patch.put("data", data.toString());
            patch.put("version", expectedVersion + 1);
            if (db.update("records", patch, "id = ? AND version = ?", new String[]{id, String.valueOf(expectedVersion)}) != 1) {
                throw new StoreError("conflict");
            }
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        return new JSONObject().put("id", id).put("values", data).put("version", expectedVersion + 1);
    }

    synchronized JSONArray list() throws JSONException {
        JSONArray rows = new JSONArray();
        try (Cursor cursor = getReadableDatabase().query("records", new String[]{"id", "data", "version"},
                null, null, null, null, "created_at ASC, id ASC", "2000")) {
            while (cursor.moveToNext()) rows.put(new JSONObject().put("id", cursor.getString(0))
                    .put("values", new JSONObject(cursor.getString(1))).put("version", cursor.getInt(2)));
        }
        return rows;
    }
}
