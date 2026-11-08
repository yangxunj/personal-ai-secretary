package com.aisecretary.sharedpilot;

/** Native capabilities for explicitly bundled topic extensions. */
interface TopicNativePlugin extends AutoCloseable {
    interface Callback { void complete(String pluginId, String requestId, String result); }
    String id();
    void request(String id, String query);
    String readCache();
    boolean writeCache(String value);
    void openLink(String value);
    @Override void close();
}
