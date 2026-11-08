package com.aisecretary.sharedpilot;

import android.app.Activity;
import java.util.HashMap;
import java.util.Map;

/** The only native composition point for reviewed, built-in topic plugins. */
final class TopicNativeRegistry implements AutoCloseable {
    private final Map<String, TopicNativePlugin> plugins = new HashMap<>();
    TopicNativeRegistry(Activity activity, TopicNativePlugin.Callback callback) {
        register(new WeekendNativePlugin(activity, callback));
    }
    private void register(TopicNativePlugin plugin) {
        if (plugins.put(plugin.id(), plugin) != null) throw new IllegalStateException("Duplicate topic plugin");
    }
    private TopicNativePlugin find(String id) { return id == null ? null : plugins.get(id); }
    void request(String pluginId, String id, String query) { TopicNativePlugin plugin = find(pluginId); if (plugin != null) plugin.request(id, query); }
    String readCache(String id) { TopicNativePlugin plugin = find(id); return plugin == null ? "" : plugin.readCache(); }
    boolean writeCache(String id, String value) { TopicNativePlugin plugin = find(id); return plugin != null && plugin.writeCache(value); }
    void openLink(String id, String value) { TopicNativePlugin plugin = find(id); if (plugin != null) plugin.openLink(value); }
    @Override public void close() { for (TopicNativePlugin plugin : plugins.values()) plugin.close(); }
}
