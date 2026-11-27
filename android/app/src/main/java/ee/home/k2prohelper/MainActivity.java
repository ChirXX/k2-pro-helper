package ee.home.k2prohelper;

import android.content.res.Configuration;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HomePlugin.class);
        super.onCreate(savedInstanceState);
    }

    private HomePlugin home() {
        if (bridge == null) return null;
        PluginHandle h = bridge.getPlugin("Home");
        return h == null ? null : (HomePlugin) h.getInstance();
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        HomePlugin h = home();
        if (h != null) h.onUserLeaveHint();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration cfg) {
        super.onPictureInPictureModeChanged(inPip, cfg);
        HomePlugin h = home();
        if (h != null) h.onPipChanged(inPip);
    }
}
