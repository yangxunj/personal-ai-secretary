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

/** Storage adapter only; field rules are executed by the shared TypeScript module. */
final class RecordStore extends SQLiteOpenHelper {
    RecordStore(Context context) { super(context, "shared-pilot.db", null, 2); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE records (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        migrate(db, oldVersion, newVersion);
    }

    static void migrate(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion == 1 && newVersion == 2) {
            db.execSQL("ALTER TABLE records ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
            return;
        }
        // Refuse unknown migrations rather than deleting user records.
        throw new IllegalStateException("Unsupported pilot database version");
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
