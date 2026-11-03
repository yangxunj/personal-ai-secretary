package com.aisecretary.sharedpilot;

import android.app.Activity;
import android.content.Intent;
import android.app.Instrumentation;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import android.webkit.WebView;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.UUID;

/** Runs on Android; compiling this test is not a device-test pass. */
@RunWith(AndroidJUnit4.class)
public final class SharedPilotTest {
    private Instrumentation getInstrumentation() { return InstrumentationRegistry.getInstrumentation(); }
    private Activity start() throws Exception {
        Intent intent = new Intent(getInstrumentation().getTargetContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = getInstrumentation().startActivitySync(intent);
        for (int attempts = 0; attempts < 40; attempts++) {
            if ("true".equals(evaluate(activity, "Boolean(window.Pilot)"))) return activity;
            Thread.sleep(250);
        }
        throw new AssertionError("Bundled WebView did not become ready");
    }

    private String evaluate(Activity activity, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        getInstrumentation().runOnMainSync(() -> {
            WebView view = (WebView) ((android.view.ViewGroup) activity.findViewById(android.R.id.content)).getChildAt(0);
            view.evaluateJavascript(script, value -> { result.set(value); done.countDown(); });
        });
        assertTrue("WebView evaluation timed out", done.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    @Test public void sharedRulesAndSQLiteSurviveActivityRestart() throws Exception {
        Activity first = start();
        try {
            String payload = (String) new JSONTokener(evaluate(first, "JSON.stringify({checks:window.Pilot.runRuleChecks(),before:window.Pilot.count(),record:window.Pilot.append({name:'安卓自动验收记录',status:'想读'}),after:window.Pilot.count()})")).nextValue();
            JSONObject result = new JSONObject(payload);
            JSONArray checks = result.getJSONArray("checks");
            assertEquals(8, checks.length());
            for (int i = 0; i < checks.length(); i++) assertTrue(checks.getJSONObject(i).getBoolean("passed"));
            assertEquals(result.getInt("before") + 1, result.getInt("after"));
            JSONObject record = result.getJSONObject("record");
            String editedPayload = (String) new JSONTokener(evaluate(first,
                    "JSON.stringify(window.Pilot.update(" + JSONObject.quote(record.getString("id")) + ",1,{status:'读完'}))")).nextValue();
            JSONObject edited = new JSONObject(editedPayload);
            assertEquals(2, edited.getInt("version"));
            assertEquals("安卓自动验收记录", edited.getJSONObject("values").getString("name"));
            assertEquals("读完", edited.getJSONObject("values").getString("status"));
            int after = result.getInt("after");
            getInstrumentation().runOnMainSync(first::finish);
            getInstrumentation().waitForIdleSync();
            Activity second = start();
            try { assertEquals(String.valueOf(after), evaluate(second, "window.Pilot.count()")); }
            finally { getInstrumentation().runOnMainSync(second::finish); }
        } finally { getInstrumentation().runOnMainSync(first::finish); }
    }

    @Test public void legacySchemaMigrationPreservesRecords() throws Exception {
        try (SQLiteDatabase db = SQLiteDatabase.create(null)) {
            db.execSQL("CREATE TABLE records (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL)");
            db.execSQL("INSERT INTO records VALUES (?, ?, ?)", new Object[]{"legacy", "{\"name\":\"旧版书单\",\"status\":\"想读\"}", 1});
            RecordStore.migrate(db, 1, 2);
            try (Cursor cursor = db.rawQuery("SELECT id, data, version FROM records", null)) {
                assertTrue(cursor.moveToFirst());
                assertEquals("legacy", cursor.getString(0));
                assertEquals("旧版书单", new JSONObject(cursor.getString(1)).getString("name"));
                assertEquals(1, cursor.getInt(2));
                assertFalse(cursor.moveToNext());
            }
        }
    }

    @Test public void secondVersionMigrationAddsReceiptsWithoutChangingRecords() throws Exception {
        try (SQLiteDatabase db = SQLiteDatabase.create(null)) {
            db.execSQL("CREATE TABLE records (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1)");
            db.execSQL("INSERT INTO records VALUES (?, ?, ?, ?)", new Object[]{"v2", "{\"name\":\"第二版保留书单\",\"status\":\"在读\"}", 1, 4});
            RecordStore.migrate(db, 2, 3);
            try (Cursor cursor = db.rawQuery("SELECT data, version FROM records WHERE id = 'v2'", null)) {
                assertTrue(cursor.moveToFirst());
                assertEquals("第二版保留书单", new JSONObject(cursor.getString(0)).getString("name"));
                assertEquals(4, cursor.getInt(1));
            }
            try (Cursor receipts = db.rawQuery("SELECT COUNT(*) FROM tool_receipts", null)) {
                assertTrue(receipts.moveToFirst()); assertEquals(0, receipts.getInt(0));
            }
        }
    }

    @Test public void nativeReceiptPreventsDuplicateToolWrites() throws Exception {
        try (RecordStore store = new RecordStore(getInstrumentation().getTargetContext())) {
            String key = "test:" + UUID.randomUUID();
            String signature = "synthetic-create";
            JSONObject operation = new JSONObject().put("kind", "create").put("values", new JSONObject().put("name", "工具回执自动验收记录").put("status", "想读"));
            int before = store.list().length();
            JSONObject first = store.commitTool(key, signature, operation.toString());
            JSONObject repeated = store.commitTool(key, signature, operation.toString());
            assertEquals(first.getString("id"), repeated.getString("id"));
            assertEquals(before + 1, store.list().length());
            try { store.commitTool(key, "changed-signature", operation.toString()); fail("Changed arguments reused a receipt key"); }
            catch (RecordStore.StoreError error) { assertEquals("conflict", error.code); }
            assertEquals(before + 1, store.list().length());
        }
    }
}
