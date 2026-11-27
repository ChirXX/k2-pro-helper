package ee.home.k2prohelper;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Rational;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * Мост между приложением и главным экраном Android:
 *  - передаёт виджету список принтеров и свежее состояние (виджет обновляется сразу, пока приложение открыто);
 *  - «картинка в картинке»: живая камера в плавающем окне поверх главного экрана и других приложений;
 *  - сообщает приложению, что его открыли кнопкой с виджета.
 */
@CapacitorPlugin(name = "Home")
public class HomePlugin extends Plugin {
    private String pendingOpen;
    private boolean autoPip;
    private long lastWidgetPush;
    private String lastWidgetState = "";

    @Override
    public void load() {
        pendingOpen = extractOpen(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        String what = extractOpen(intent);
        if (what == null) return;
        JSObject o = new JSObject();
        o.put("what", what);
        notifyListeners("open", o, true);
    }

    private static String extractOpen(Intent i) {
        if (i == null) return null;
        String w = i.getStringExtra(PrinterWidget.EXTRA_OPEN);
        if (w != null) i.removeExtra(PrinterWidget.EXTRA_OPEN);
        return w;
    }

    /** Что попросил открыть виджет при холодном старте приложения (printer | cam | null). */
    @PluginMethod
    public void pending(PluginCall call) {
        JSObject r = new JSObject();
        r.put("what", pendingOpen);
        pendingOpen = null;
        call.resolve(r);
    }

    /** Список принтеров и выбранный — для виджета. {printers:[{n,host,type,ctl}], idx} */
    @PluginMethod
    public void sync(PluginCall call) {
        Context ctx = getContext();
        String list = call.getArray("printers") != null ? call.getArray("printers").toString() : "[]";
        PrinterWidget.prefs(ctx).edit().putString("printers", list).putInt("idx", call.getInt("idx", 0)).apply();
        PrinterWidget.renderAll(ctx);
        call.resolve();
    }

    /** Свежее состояние принтера из приложения: {host, view}. Перерисовываем виджет не чаще раза в 20 с, если ничего важного не поменялось. */
    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        String host = call.getString("host", "");
        JSObject v = call.getObject("view");
        if (v == null || host.isEmpty()) { call.resolve(); return; }
        try {
            JSONObject slim = new JSONObject();
            for (String k : new String[]{"s", "file", "prog", "left", "noz", "nozT", "bed", "bedT", "box", "light", "err", "cam", "elapsed", "mm"})
                if (v.has(k) && !v.isNull(k)) slim.put(k, v.get(k));
            String key = host + slim.optString("s") + slim.optString("file") + slim.optBoolean("light");
            long now = System.currentTimeMillis();
            if (key.equals(lastWidgetState) && now - lastWidgetPush < 20000) { call.resolve(); return; }
            lastWidgetState = key;
            lastWidgetPush = now;
            PrinterWidget.saveState(ctx, host, slim);
            PrinterWidget.renderAll(ctx);
            PrinterWidget.schedule(ctx, slim);
        } catch (Exception ignored) {}
        call.resolve();
    }

    /** Открыть Creality Cloud (или его страницу в Google Play). */
    @PluginMethod
    public void openCloud(PluginCall call) {
        JSObject r = new JSObject();
        boolean installed = getContext().getPackageManager().getLaunchIntentForPackage(PrinterWidget.CLOUD_PKG) != null;
        try { getContext().startActivity(PrinterWidget.cloudIntent(getContext())); r.put("ok", true); }
        catch (Exception e) { r.put("ok", false); }
        r.put("installed", installed);
        call.resolve(r);
    }

    /** Приложение не достучалось до принтера — виджет показывает кнопку Creality Cloud. */
    @PluginMethod
    public void offline(PluginCall call) {
        Context ctx = getContext();
        lastWidgetState = "";
        PrinterWidget.prefs(ctx).edit().putString("err", "Нет связи с принтером").apply();
        PrinterWidget.renderAll(ctx);
        call.resolve();
    }

    /** Печати, которые виджет заметил завершёнными, пока приложение было закрыто. Забираем и очищаем. */
    @PluginMethod
    public void takePrints(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        try { r.put("prints", new com.getcapacitor.JSArray(PrinterWidget.prefs(ctx).getString("prints", "[]"))); }
        catch (Exception e) { r.put("prints", new com.getcapacitor.JSArray()); }
        PrinterWidget.prefs(ctx).edit().remove("prints").apply();
        call.resolve(r);
    }

    /** Есть ли уже виджет и можно ли предложить закрепить его кнопкой. */
    @PluginMethod
    public void widgetInfo(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("count", PrinterWidget.ids(ctx).length);
        boolean canPin = Build.VERSION.SDK_INT >= 26 && AppWidgetManager.getInstance(ctx).isRequestPinAppWidgetSupported();
        r.put("canPin", canPin);
        r.put("pip", pipSupported());
        call.resolve(r);
    }

    /** Попросить лаунчер добавить виджет (Android 8+). Лаунчер сам покажет окно подтверждения. */
    @PluginMethod
    public void addWidget(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        boolean ok = false;
        if (Build.VERSION.SDK_INT >= 26) {
            AppWidgetManager m = AppWidgetManager.getInstance(ctx);
            if (m.isRequestPinAppWidgetSupported())
                ok = m.requestPinAppWidget(new ComponentName(ctx, PrinterWidget.class), null, null);
        }
        r.put("ok", ok);
        call.resolve(r);
    }

    /* ---------------- картинка в картинке ---------------- */

    boolean pipSupported() {
        return Build.VERSION.SDK_INT >= 26
                && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    @RequiresApi(26)
    private PictureInPictureParams params(boolean auto) {
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9));
        if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(auto).setSeamlessResizeEnabled(false);
        return b.build();
    }

    /** Свернуть приложение в плавающее окно с камерой. */
    @PluginMethod
    public void pip(PluginCall call) {
        JSObject r = new JSObject();
        if (Build.VERSION.SDK_INT < 26 || !pipSupported()) { r.put("ok", false); call.resolve(r); return; }
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            boolean ok = false;
            if (Build.VERSION.SDK_INT >= 26) {
                try { ok = a.enterPictureInPictureMode(params(autoPip)); } catch (Exception ignored) {}
            }
            r.put("ok", ok);
            call.resolve(r);
        });
    }

    /** Камера на экране → при нажатии «Домой» видео само уходит в плавающее окно. */
    @PluginMethod
    public void autoPip(PluginCall call) {
        autoPip = Boolean.TRUE.equals(call.getBoolean("on", false));
        if (Build.VERSION.SDK_INT >= 31 && pipSupported()) {
            Activity a = getActivity();
            a.runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 31) {
                    try { a.setPictureInPictureParams(params(autoPip)); } catch (Exception ignored) {}
                }
            });
        }
        call.resolve();
    }

    /** Вызывается из MainActivity.onUserLeaveHint (Android 8–11: там нет автоперехода). */
    void onUserLeaveHint() {
        if (Build.VERSION.SDK_INT >= 26 && Build.VERSION.SDK_INT < 31 && autoPip && pipSupported()) {
            try { getActivity().enterPictureInPictureMode(params(false)); } catch (Exception ignored) {}
        }
    }

    void onPipChanged(boolean inPip) {
        JSObject o = new JSObject();
        o.put("pip", inPip);
        notifyListeners("pipChange", o);
    }
}
