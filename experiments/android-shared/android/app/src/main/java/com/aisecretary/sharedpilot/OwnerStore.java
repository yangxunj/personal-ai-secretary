package com.aisecretary.sharedpilot;

import android.content.SharedPreferences;
import org.json.JSONArray;
import java.util.HashSet;
import java.util.Locale;

/** Private platform storage; UI validation is shared with web/Windows. */
final class OwnerStore {
    private final SharedPreferences preferences;
    OwnerStore(SharedPreferences preferences) { this.preferences = preferences; }

    synchronized JSONArray read() throws Exception {
        String serialized = preferences.getString("owners", null);
        return serialized == null ? null : validate(serialized);
    }
    synchronized JSONArray write(String serialized) throws Exception {
        JSONArray names = validate(serialized);
        if (!preferences.edit().putString("owners", names.toString()).commit()) throw new IllegalStateException("Owner storage failed");
        return names;
    }
    private static JSONArray validate(String serialized) throws Exception {
        if (serialized == null || serialized.length() > 1000) throw new IllegalArgumentException("Invalid owner list");
        JSONArray names = new JSONArray(serialized); HashSet<String> seen = new HashSet<>();
        if (names.length() < 1 || names.length() > 12) throw new IllegalArgumentException("Invalid owner count");
        for (int i = 0; i < names.length(); i++) {
            Object item = names.get(i);
            if (!(item instanceof String)) throw new IllegalArgumentException("Invalid owner name");
            String name = (String) item, lower = name.toLowerCase(Locale.ROOT);
            if (name.length() == 0 || name.length() > 12 || !name.equals(name.trim()) || !seen.add(name)
                    || name.contains(",") || name.contains("，") || name.contains("、") || name.contains("\n")
                    || lower.equals("待定") || lower.equals("未指派") || lower.equals("unassigned"))
                throw new IllegalArgumentException("Invalid owner name");
        }
        return names;
    }
}
