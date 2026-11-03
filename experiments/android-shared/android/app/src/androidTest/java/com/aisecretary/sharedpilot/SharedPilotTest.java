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
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

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
            assertEquals(6, checks.length());
            for (int i = 0; i < checks.length(); i++) assertTrue(checks.getJSONObject(i).getBoolean("passed"));
            assertEquals(result.getInt("before") + 1, result.getInt("after"));
            int after = result.getInt("after");
            getInstrumentation().runOnMainSync(first::finish);
            getInstrumentation().waitForIdleSync();
            Activity second = start();
            try { assertEquals(String.valueOf(after), evaluate(second, "window.Pilot.count()")); }
            finally { getInstrumentation().runOnMainSync(second::finish); }
        } finally { getInstrumentation().runOnMainSync(first::finish); }
    }
}
