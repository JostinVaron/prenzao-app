package co.prenzao.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareIntakePlugin.class);
        super.onCreate(savedInstanceState);
        handleShare(getIntent(), false);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShare(intent, true);
    }

    private void handleShare(Intent intent, boolean live) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.trim().isEmpty()) return;
        ShareIntakePlugin.pending = text;
        if (live && getBridge() != null) {
            PluginHandle h = getBridge().getPlugin("ShareIntake");
            if (h != null) ((ShareIntakePlugin) h.getInstance()).deliver(text);
        }
    }
}
