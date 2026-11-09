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
import android.webkit.PermissionRequest;
import android.net.Uri;
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
    @Test public void microphonePermissionOnlyForBundledOriginAndAudio() {
        String audio = PermissionRequest.RESOURCE_AUDIO_CAPTURE;
        String video = PermissionRequest.RESOURCE_VIDEO_CAPTURE;
        assertTrue(MainActivity.allowsMicrophone(Uri.parse("https://appassets.androidplatform.net"), new String[]{audio}));
        assertFalse(MainActivity.allowsMicrophone(Uri.parse("https://evil.example"), new String[]{audio}));
        assertFalse(MainActivity.allowsMicrophone(Uri.parse("http://appassets.androidplatform.net"), new String[]{audio}));
        assertFalse(MainActivity.allowsMicrophone(Uri.parse("https://appassets.androidplatform.net:444"), new String[]{audio}));
        assertFalse(MainActivity.allowsMicrophone(Uri.parse("https://user@appassets.androidplatform.net"), new String[]{audio}));
        assertFalse(MainActivity.allowsMicrophone(Uri.parse("https://appassets.androidplatform.net"), new String[]{audio, video}));
        assertFalse(MainActivity.allowsMicrophone(Uri.parse("https://appassets.androidplatform.net"), new String[]{video}));
        assertFalse(MainActivity.allowsMicrophone(null, new String[]{audio}));
    }
    @Test public void voiceAudioValidationAndDownloadOrigin() throws Exception {
        byte[] wav = new byte[8044]; java.nio.ByteBuffer b = java.nio.ByteBuffer.wrap(wav).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes("US-ASCII")).putInt(wav.length - 8).put("WAVEfmt ".getBytes("US-ASCII"));
        b.putInt(16).putShort((short) 1).putShort((short) 1).putInt(16000).putInt(32000).putShort((short) 2).putShort((short) 16);
        b.put("data".getBytes("US-ASCII")).putInt(wav.length - 44);
        assertTrue(VoiceClient.validWav(wav)); wav[24] = 0; assertFalse(VoiceClient.validWav(wav));
        assertEquals("https", VoiceClient.trustedAudioUrl("http://dashscope-result-x.oss-cn-x.aliyuncs.com/a?signature=x").getProtocol());
        for (String url : new String[]{"https://example.com/a", "https://dashscope-result-x.oss-cn-x.aliyuncs.com.evil.com/a", "https://user@dashscope-result-x.oss-cn-x.aliyuncs.com/a", "https://dashscope-result-x.oss-cn-x.aliyuncs.com:443/a"}) {
            try { VoiceClient.trustedAudioUrl(url); fail("untrusted URL accepted"); } catch (IllegalArgumentException expected) { }
        }
    }
    @Test public void taskConversationMigrationIsolationArchiveAndDetachment() throws Exception {
        try (SQLiteDatabase db = SQLiteDatabase.create(null)) {
            TaskStore.createTable(db);
            db.execSQL("CREATE TABLE conversations (id TEXT PRIMARY KEY, mode TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
            JSONObject general = new JSONObject().put("schemaVersion", 1).put("id", "general").put("mode", "deepseek").put("title", "general").put("draft", "").put("turns", new JSONArray());
            db.execSQL("INSERT INTO conversations VALUES (?,?,?,?,?,?)", new Object[]{"general", "deepseek", "general", general.toString(), 1, 100});
            RecordStore.migrate(db, 6, 7);
            JSONObject task = new JSONObject().put("title", "task").put("detail", "original").put("status", "todo").put("category", "其他").put("priority", 2).put("owner", JSONObject.NULL).put("dueDate", JSONObject.NULL).put("result", JSONObject.NULL);
            String first = TaskStore.create(db, task.toString()).getString("id"), second = TaskStore.create(db, task.toString()).getString("id");
            JSONObject snapshot = new JSONObject().put("schemaVersion", 1).put("id", "task-chat").put("mode", "deepseek").put("title", "task chat").put("draft", "keep draft").put("turns", new JSONArray());
            ConversationStore.saveTask(db, first, "task-chat", 0, snapshot.toString());
            assertEquals(1, ConversationStore.list(db, "deepseek").length()); assertNull(ConversationStore.readGeneral(db, "task-chat"));
            assertEquals("keep draft", ConversationStore.readTask(db, first).getJSONObject("snapshot").getString("draft"));
            assertNull(ConversationStore.readTask(db, second));
            try { ConversationStore.saveTask(db, second, "task-chat", 1, snapshot.toString()); fail("Cross-task write accepted"); } catch (RecordStore.StoreError expected) { assertEquals("conflict", expected.code); }
            try { ConversationStore.save(db, "task-chat", 1, snapshot.toString()); fail("General write to task chat accepted"); } catch (RecordStore.StoreError expected) { assertEquals("conflict", expected.code); }
            TaskStore.setArchived(db, first, 1, true);
            assertNotNull(ConversationStore.readTask(db, first));
            try { ConversationStore.saveTask(db, first, "task-chat", 1, snapshot.toString()); fail("Archived chat write accepted"); } catch (RecordStore.StoreError expected) { assertEquals("conflict", expected.code); }
            TaskStore.setArchived(db, first, 2, false); TaskStore.setArchived(db, first, 3, true);
            db.beginTransaction(); try { TaskStore.deleteArchived(db, first, 4); ConversationStore.detachTask(db, first); db.setTransactionSuccessful(); } finally { db.endTransaction(); }
            assertEquals("keep draft", ConversationStore.readGeneral(db, "task-chat").getJSONObject("snapshot").getString("draft"));
            assertEquals(2, ConversationStore.list(db, "deepseek").length()); assertNotNull(TaskStore.read(db, second));
        }
    }
    @Test public void taskArchiveMigrationAndDeletePreserveExistingData() throws Exception {
        try (SQLiteDatabase db = SQLiteDatabase.create(null)) {
            db.execSQL("CREATE TABLE tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, category TEXT NOT NULL, priority INTEGER NOT NULL, due_date TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1)");
            db.execSQL("CREATE TABLE records (id TEXT PRIMARY KEY)"); db.execSQL("INSERT INTO records VALUES ('keep-book')");
            db.execSQL("CREATE TABLE conversations (id TEXT PRIMARY KEY)"); db.execSQL("INSERT INTO conversations VALUES ('keep-chat')");
            JSONObject data = new JSONObject().put("title", "旧任务").put("detail", "原始要求").put("status", "doing").put("category", "其他").put("priority", 2).put("owner", JSONObject.NULL).put("dueDate", JSONObject.NULL).put("result", JSONObject.NULL);
            db.execSQL("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?)", new Object[]{"legacy", data.toString(), "旧任务", "doing", "其他", 2, null, 100, 100, 3});
            RecordStore.migrate(db, 5, 6);
            JSONObject original = TaskStore.read(db, "legacy"); assertTrue(original.isNull("archivedAt")); assertEquals("原始要求", original.getString("detail"));
            try { TaskStore.deleteArchived(db, "legacy", 3); fail("Unarchived task deleted"); } catch (RecordStore.StoreError expected) { assertEquals("conflict", expected.code); }
            JSONObject archived = TaskStore.setArchived(db, "legacy", 3, true); assertFalse(archived.isNull("archivedAt")); assertEquals("doing", archived.getString("status"));
            JSONObject plan = new JSONObject().put("statuses", new JSONArray().put("doing")).put("limit", 20).put("category", JSONObject.NULL).put("keyword", JSONObject.NULL);
            assertEquals(0, TaskStore.list(db, plan.toString()).length());
            try { TaskStore.update(db, "legacy", 4, "{\"status\":\"done\"}"); fail("Archived task edited"); } catch (RecordStore.StoreError expected) { assertEquals("conflict", expected.code); }
            try { TaskStore.deleteArchived(db, "legacy", 3); fail("Stale task deleted"); } catch (RecordStore.StoreError expected) { assertEquals("conflict", expected.code); }
            JSONObject restored = TaskStore.setArchived(db, "legacy", 4, false); assertTrue(restored.isNull("archivedAt")); assertEquals("doing", restored.getString("status"));
            assertEquals(1, TaskStore.list(db, plan.toString()).length());
            TaskStore.setArchived(db, "legacy", 5, true); TaskStore.deleteArchived(db, "legacy", 6); assertNull(TaskStore.read(db, "legacy"));
            assertEquals(1, android.database.DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM records", null));
            assertEquals(1, android.database.DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM conversations", null));
        }
    }
    @Test public void deletingOneConversationChecksVersionAndPreservesOtherData() throws Exception {
        try (SQLiteDatabase db = SQLiteDatabase.create(null)) {
            ConversationStore.createTable(db);
            db.execSQL("CREATE TABLE records (id TEXT PRIMARY KEY)");
            db.execSQL("CREATE TABLE tasks (id TEXT PRIMARY KEY)");
            db.execSQL("INSERT INTO records VALUES ('keep-book')");
            db.execSQL("INSERT INTO tasks VALUES ('keep-task')");
            JSONObject one = new JSONObject().put("schemaVersion", 1).put("id", "one").put("mode", "deepseek").put("title", "first").put("draft", "").put("turns", new JSONArray());
            JSONObject two = new JSONObject().put("schemaVersion", 1).put("id", "two").put("mode", "deepseek").put("title", "second").put("draft", "").put("turns", new JSONArray());
            ConversationStore.save(db, "one", 0, one.toString()); ConversationStore.save(db, "two", 0, two.toString());
            ConversationStore.save(db, "one", 1, one.toString());
            long updatedAt = android.database.DatabaseUtils.longForQuery(db, "SELECT updated_at FROM conversations WHERE id='one'", null);
            try { ConversationStore.setTitle(db, "one", 1, "first", "new title"); fail("Stale title accepted"); } catch (RecordStore.StoreError expected) { assertEquals("conflict", expected.code); }
            try { ConversationStore.setTitle(db, "one", 2, "changed", "new title"); fail("Changed title overwritten"); } catch (RecordStore.StoreError expected) { assertEquals("conflict", expected.code); }
            assertEquals("new title", ConversationStore.setTitle(db, "one", 2, "first", "new title").getJSONObject("snapshot").getString("title"));
            assertEquals(updatedAt, android.database.DatabaseUtils.longForQuery(db, "SELECT updated_at FROM conversations WHERE id='one'", null));
            try { ConversationStore.delete(db, "one", "deepseek", 1); fail("Stale version deleted"); } catch (RecordStore.StoreError expected) { assertEquals("conflict", expected.code); }
            try { ConversationStore.delete(db, "one", "demo", 3); fail("Wrong mode deleted"); } catch (RecordStore.StoreError expected) { assertEquals("conflict", expected.code); }
            assertNotNull(ConversationStore.read(db, "one"));
            ConversationStore.delete(db, "one", "deepseek", 3);
            assertNull(ConversationStore.read(db, "one")); assertNotNull(ConversationStore.read(db, "two"));
            assertEquals(1, android.database.DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM records", null));
            assertEquals(1, android.database.DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM tasks", null));
        }
    }
    @Test public void webLinksOnlyAllowPublicHttpDomains() {
        assertTrue(DeepSeekClient.isPublicWebUrl("https://example.com/info"));
        for (String url : new String[]{"file:///tmp/a", "http://127.0.0.1", "https://printer.local/a", "https://user@example.com/", "https://example.com:8443/", "javascript:alert(1)"}) {
            assertFalse(url, DeepSeekClient.isPublicWebUrl(url));
        }
    }
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

    @Test public void mobileNavigationSwitchesScreensWithoutDiscardingDraft() throws Exception {
        Activity activity = start();
        try {
            for (int attempts = 0; attempts < 40; attempts++) {
                if ("7".equals(evaluate(activity, "document.querySelectorAll('#pilot-navigation button').length"))) break;
                Thread.sleep(100);
            }
            assertEquals("7", evaluate(activity, "document.querySelectorAll('#pilot-navigation button').length"));
            evaluate(activity, "document.querySelectorAll('#pilot-navigation button')[1].click();document.querySelector('#task-title').value='unsaved draft';");
            assertEquals("false", evaluate(activity, "document.querySelector('.task-panel').hidden"));
            evaluate(activity, "document.querySelectorAll('#pilot-navigation button')[0].click();document.querySelectorAll('#pilot-navigation button')[1].click();");
            assertEquals("\"unsaved draft\"", evaluate(activity, "document.querySelector('#task-title').value"));
            evaluate(activity, "document.querySelectorAll('#pilot-navigation button')[3].click();");
            assertEquals("false", evaluate(activity, "document.querySelector('.pilot-unavailable').hidden"));
            assertEquals("\"财务\"", evaluate(activity, "document.querySelector('#pilot-page-header h1').textContent"));
        } finally { getInstrumentation().runOnMainSync(activity::finish); }
    }

    @Test public void weekendTopicCanBeOpenedWithoutStartingNetworkRequests() throws Exception {
        Activity activity = start();
        try {
            for (int attempts = 0; attempts < 40; attempts++) {
                if ("7".equals(evaluate(activity, "document.querySelectorAll('#pilot-navigation button').length"))) break;
                Thread.sleep(100);
            }
            evaluate(activity, "document.querySelectorAll('#pilot-navigation button')[5].click()");
            assertEquals("false", evaluate(activity, "document.querySelector('.pilot-topics').hidden"));
            evaluate(activity, "document.querySelector('.pilot-topic-card').click()");
            assertEquals("false", evaluate(activity, "document.querySelector('.pilot-weekend').hidden"));
            assertEquals("true", evaluate(activity, "Boolean(document.querySelector('#weekend-refresh'))"));
            assertEquals("true", evaluate(activity, "Boolean(document.querySelector('#weekend-recommend') && document.querySelector('#weekend-preference') && window.SecretaryAI.request)"));
            assertEquals("true", evaluate(activity, "typeof window.SecretaryStorage.topicReadCache('hk-weekend') === 'string'"));
            assertEquals("false", evaluate(activity, "window.SecretaryStorage.topicWriteCache('unknown-plugin', '{}')"));
        } finally { getInstrumentation().runOnMainSync(activity::finish); }
    }

    @Test public void conversationDrawerOpensClosesAndCreatesConversation() throws Exception {
        Activity activity = start();
        try {
            for (int attempts = 0; attempts < 40; attempts++) {
                if ("true".equals(evaluate(activity, "Boolean(document.querySelector('#pilot-page-header button[aria-label=对话列表]'))"))) break;
                Thread.sleep(100);
            }
            evaluate(activity, "document.querySelector('#pilot-page-header button[aria-label=对话列表]').click()");
            assertEquals("false", evaluate(activity, "document.querySelector('#pilot-conversation-drawer [aria-modal]').parentElement.getAttribute('aria-hidden') === 'true'"));
            evaluate(activity, "document.querySelector('#pilot-conversation-drawer [data-drawer-backdrop]').click()");
            assertEquals("true", evaluate(activity, "document.querySelector('#pilot-conversation-drawer [aria-modal]').parentElement.getAttribute('aria-hidden') === 'true'"));
            evaluate(activity, "document.querySelector('#pilot-page-header button[aria-label=对话列表]').click();document.querySelector('#shared-conversation-list button').click()");
            assertEquals("true", evaluate(activity, "document.querySelector('#pilot-conversation-drawer [aria-modal]').parentElement.getAttribute('aria-hidden') === 'true'"));
        } finally { getInstrumentation().runOnMainSync(activity::finish); }
    }

    @Test public void composerSitsAboveNavigationAndModelSettingsAreOnSettingsPage() throws Exception {
        Activity activity = start();
        try {
            for (int attempts = 0; attempts < 40; attempts++) {
                if ("true".equals(evaluate(activity, "Boolean(document.querySelector('#pilot-page-header button[aria-label=设置]') && document.documentElement.style.getPropertyValue('--pilot-nav-height'))"))) break;
                Thread.sleep(100);
            }
            assertEquals("true", evaluate(activity, "(()=>{const nav=document.querySelector('#pilot-navigation nav').getBoundingClientRect(), box=document.querySelector('#ai-form').getBoundingClientRect(); return Math.abs(box.bottom-(nav.height ? nav.top : innerHeight)) <= 2})()"));
            assertEquals("true", evaluate(activity, "document.querySelector('#model-key').closest('[data-screen]').dataset.screen === '/settings'"));
            evaluate(activity, "document.querySelector('#pilot-page-header button[aria-label=设置]').click()");
            assertEquals("false", evaluate(activity, "document.querySelector('.pilot-settings').hidden"));
            evaluate(activity, "document.querySelector('input[name=ai-mode][value=demo]').click();document.querySelectorAll('#pilot-navigation button')[0].click()");
            assertEquals("\"demo\"", evaluate(activity, "document.querySelector('#ai-form').dataset.mode"));
            evaluate(activity, "document.querySelector('#pilot-page-header button[aria-label=设置]').click();document.querySelector('input[name=ai-mode][value=deepseek]').click();document.querySelectorAll('#pilot-navigation button')[0].click()");
            assertEquals("\"deepseek\"", evaluate(activity, "document.querySelector('#ai-form').dataset.mode"));
        } finally { getInstrumentation().runOnMainSync(activity::finish); }
    }

    @Test public void transcriptUsesAvailableSpaceAndCanScrollToBothEnds() throws Exception {
        Activity activity = start();
        try {
            for (int attempts = 0; attempts < 40; attempts++) {
                if ("true".equals(evaluate(activity, "Boolean(document.documentElement.style.getPropertyValue('--pilot-header-height'))"))) break;
                Thread.sleep(100);
            }
            assertEquals("true", evaluate(activity, "document.querySelector('#conversation-status').textContent === ''"));
            assertEquals("true", evaluate(activity, "(()=>{const p=document.querySelector('.ai-panel').getBoundingClientRect(),h=document.querySelector('#pilot-page-header header').getBoundingClientRect(),f=document.querySelector('#ai-form').getBoundingClientRect(); return Math.abs(p.top-h.bottom)<2 && Math.abs(p.bottom-f.top)<2})()"));
            evaluate(activity, "(()=>{const list=document.querySelector('#conversation-messages');const a=document.createElement('li'),b=document.createElement('li');a.textContent='first';b.textContent='last';b.style.minHeight='1500px';list.replaceChildren(a,b)})()");
            assertEquals("true", evaluate(activity, "(()=>{const p=document.querySelector('.ai-panel');p.scrollTop=0;return p.scrollTop===0 && p.scrollHeight>p.clientHeight})()"));
            assertEquals("true", evaluate(activity, "(()=>{const p=document.querySelector('.ai-panel');p.scrollTop=p.scrollHeight;return Math.abs(p.scrollHeight-p.clientHeight-p.scrollTop)<2})()"));
        } finally { getInstrumentation().runOnMainSync(activity::finish); }
    }

    @Test public void sharedRulesAndSQLiteSurviveActivityRestart() throws Exception {
        Activity first = start();
        try {
            String payload = (String) new JSONTokener(evaluate(first, "JSON.stringify({checks:window.Pilot.runRuleChecks(),before:window.Pilot.count(),record:window.Pilot.append({name:'安卓自动验收记录',status:'想读'}),after:window.Pilot.count()})")).nextValue();
            JSONObject result = new JSONObject(payload);
            JSONArray checks = result.getJSONArray("checks");
            assertEquals(10, checks.length());
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

    @Test public void tasksAreSeparateAndPartialUpdatesKeepRequirements() throws Exception {
        try (RecordStore store = new RecordStore(getInstrumentation().getTargetContext())) {
            int booksBefore = store.list().length();
            JSONObject data = new JSONObject().put("title", "安卓任务自动验收").put("detail", "保留原始要求")
                    .put("category", "其他").put("priority", 2).put("status", "todo").put("owner", JSONObject.NULL).put("dueDate", JSONObject.NULL).put("result", JSONObject.NULL);
            JSONObject task = store.writeTask(data.toString(), null, 0);
            JSONObject patch = new JSONObject().put("status", "done");
            JSONObject updated = store.writeTask(patch.toString(), task.getString("id"), 1);
            assertEquals("保留原始要求", updated.getString("detail")); assertEquals("done", updated.getString("status"));
            assertEquals(booksBefore, store.list().length());
            try { store.writeTask(patch.toString(), task.getString("id"), 1); fail("Stale task update accepted"); }
            catch (RecordStore.StoreError error) { assertEquals("conflict", error.code); }
        }
    }

    @Test public void fullTaskListExceedsToolLimitAndRetainsCreationTime() throws Exception {
        try (SQLiteDatabase db = SQLiteDatabase.create(null)) {
            TaskStore.createTable(db);
            JSONObject data = new JSONObject().put("title", "synthetic task").put("detail", JSONObject.NULL)
                    .put("category", "其他").put("priority", 2).put("status", "todo").put("owner", JSONObject.NULL)
                    .put("dueDate", JSONObject.NULL).put("result", JSONObject.NULL);
            for (int i = 0; i < 65; i++) TaskStore.create(db, data.toString());
            JSONArray all = TaskStore.listForView(db);
            assertEquals(65, all.length()); assertTrue(all.getJSONObject(0).has("createdAt"));
            JSONObject plan = new JSONObject().put("statuses", new JSONArray().put("todo"))
                    .put("limit", 50).put("category", JSONObject.NULL).put("keyword", JSONObject.NULL);
            assertEquals(50, TaskStore.list(db, plan.toString()).length());
        }
    }

    @Test public void ownerPreferencesSurviveReopenAndRejectInvalidReplacement() throws Exception {
        android.content.Context context = getInstrumentation().getTargetContext();
        String testName = "pilot-owner-test-" + java.util.UUID.randomUUID();
        try {
            OwnerStore owners = new OwnerStore(context.getSharedPreferences(testName, android.content.Context.MODE_PRIVATE));
            assertNull(owners.read());
            owners.write(new JSONArray().put("Alice").put("Bob").toString());
            OwnerStore reopened = new OwnerStore(context.getSharedPreferences(testName, android.content.Context.MODE_PRIVATE));
            assertEquals("Alice", reopened.read().getString(0));
            try { reopened.write(new JSONArray().put("unassigned").toString()); fail("Invalid owner accepted"); }
            catch (IllegalArgumentException expected) { }
            assertEquals(2, reopened.read().length());
        } finally { context.deleteSharedPreferences(testName); }
    }

    @Test public void fourthVersionMigrationAndConversationConflictPreserveBusinessData() throws Exception {
        try (SQLiteDatabase db = SQLiteDatabase.create(null)) {
            db.execSQL("CREATE TABLE records (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1)");
            db.execSQL("CREATE TABLE tool_receipts (call_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL)");
            TaskStore.createTable(db);
            db.execSQL("INSERT INTO records VALUES ('kept', '{}', 1, 3)");
            RecordStore.migrate(db, 4, 5);
            String id = "test-chat";
            JSONObject snapshot = new JSONObject().put("id", id).put("mode", "deepseek").put("schemaVersion", 1)
                    .put("title", "保留会话").put("draft", "未发送草稿").put("turns", new JSONArray());
            JSONObject saved = ConversationStore.save(db, id, 0, snapshot.toString());
            assertEquals(1, saved.getInt("version"));
            assertEquals("未发送草稿", ConversationStore.read(db, id).getJSONObject("snapshot").getString("draft"));
            try { ConversationStore.save(db, id, 0, snapshot.toString()); fail("Stale snapshot accepted"); }
            catch (RecordStore.StoreError error) { assertEquals("conflict", error.code); }
            assertEquals(1, ConversationStore.list(db, "deepseek").length());
            assertEquals(0, ConversationStore.list(db, "demo").length());
            try (Cursor cursor = db.rawQuery("SELECT version FROM records WHERE id='kept'", null)) {
                assertTrue(cursor.moveToFirst()); assertEquals(3, cursor.getInt(0));
            }
        }
    }

    @Test public void sharedReactMessageBodyRendersInsideWebView() throws Exception {
        Activity activity = start();
        try {
            String markdown = "**共用正文**\n\n| 一 | 二 |\n|---|---|\n| A | B |\n\n<script>window.unexpectedScript=true</script>";
            String script = "(function(){const list=document.createElement('ol');const ui=window.PilotMessageUI.createTranscript(list,function(){});ui.render([{id:'render-test',prompt:'test',status:'complete',reply:"
                    + JSONObject.quote(markdown) + "}], 'interrupted');return JSON.stringify({strong:list.querySelectorAll('strong').length,table:list.querySelectorAll('table').length,scripts:list.querySelectorAll('script').length});})()";
            JSONObject result = new JSONObject((String) new JSONTokener(evaluate(activity, script)).nextValue());
            assertEquals(1, result.getInt("strong")); assertEquals(1, result.getInt("table")); assertEquals(0, result.getInt("scripts"));
        } finally { getInstrumentation().runOnMainSync(activity::finish); }
    }
}
