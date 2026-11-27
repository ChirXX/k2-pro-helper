package ee.home.k2prohelper;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Виджет на главный экран: состояние печати, температуры, снимок с камеры (или превью модели)
 * и быстрые кнопки — обновить, подсветка, пауза/продолжить, живая камера.
 * Живое видео в виджете Android показать нельзя (система не пускает туда видео), поэтому кнопка
 * «Камера» открывает приложение и сразу уводит видео в плавающее окно поверх главного экрана.
 */
public class PrinterWidget extends AppWidgetProvider {
    static final String PREFS = "k2widget";
    static final String A_REFRESH = "ee.home.k2prohelper.W_REFRESH";
    static final String A_RENDER = "ee.home.k2prohelper.W_RENDER";
    static final String A_LIGHT = "ee.home.k2prohelper.W_LIGHT";
    static final String A_PAUSE = "ee.home.k2prohelper.W_PAUSE";
    static final String A_RESUME = "ee.home.k2prohelper.W_RESUME";
    static final String EXTRA_OPEN = "k2open";
    /** Пока идёт печать — обновляемся сами примерно раз в 2 минуты (Android может делать это реже ради батареи). */
    static final long ACTIVE_EVERY = 2 * 60 * 1000;
    static final long ARM_MS = 5000;

    /* ---------------- жизненный цикл ---------------- */

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        renderAll(ctx);
        refreshAsync(ctx, null, 0);
    }

    @Override
    public void onDisabled(Context ctx) {
        alarm(ctx).cancel(pi(ctx, A_REFRESH, 1));
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String a = intent.getAction();
        if (a == null) return;
        switch (a) {
            case A_REFRESH: refreshAsync(ctx, null, 0); break;
            case A_RENDER: renderAll(ctx); break;
            case A_RESUME: refreshAsync(ctx, "resume", 0); break;
            case A_LIGHT: {
                JSONObject st = state(ctx);
                refreshAsync(ctx, "light", st != null && st.optBoolean("light", false) ? 0 : 1);
                break;
            }
            case A_PAUSE: {
                // пауза — с подтверждением: первое нажатие «взводит» кнопку, второе в течение 5 секунд отправляет
                SharedPreferences p = prefs(ctx);
                long now = System.currentTimeMillis();
                if (now < p.getLong("armUntil", 0)) {
                    p.edit().putLong("armUntil", 0).apply();
                    refreshAsync(ctx, "pause", 0);
                } else {
                    p.edit().putLong("armUntil", now + ARM_MS).apply();
                    renderAll(ctx);
                    alarm(ctx).set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + ARM_MS + 300, pi(ctx, A_RENDER, 6));
                }
                break;
            }
        }
    }

    /* ---------------- данные ---------------- */

    static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** Выбранный в приложении принтер: {n, host, type, ctl}. */
    static JSONObject printer(Context ctx) {
        try {
            JSONArray L = new JSONArray(prefs(ctx).getString("printers", "[]"));
            if (L.length() == 0) return null;
            int i = Math.max(0, Math.min(prefs(ctx).getInt("idx", 0), L.length() - 1));
            return L.getJSONObject(i);
        } catch (Exception e) { return null; }
    }

    /** Последнее известное состояние выбранного принтера (или null). */
    static JSONObject state(Context ctx) {
        try {
            JSONObject P = printer(ctx);
            JSONObject st = new JSONObject(prefs(ctx).getString("state", "{}"));
            if (P == null || !P.optString("host").equals(st.optString("host"))) return null;
            return st;
        } catch (Exception e) { return null; }
    }

    /** Сохранить свежее состояние (из виджета или из открытого приложения). */
    static void saveState(Context ctx, String host, JSONObject v) {
        try {
            v.put("host", host);
            v.put("at", System.currentTimeMillis());
            prefs(ctx).edit().putString("state", v.toString()).remove("err").apply();
        } catch (Exception ignored) {}
    }

    private static File picFile(Context ctx) { return new File(ctx.getCacheDir(), "widget_pic.jpg"); }

    private static void savePic(Context ctx, String host, Bitmap b) {
        File f = picFile(ctx);
        if (b == null) { f.delete(); prefs(ctx).edit().remove("picHost").apply(); return; }
        try (FileOutputStream o = new FileOutputStream(f)) {
            b.compress(Bitmap.CompressFormat.JPEG, 85, o);
            prefs(ctx).edit().putString("picHost", host).putLong("picAt", System.currentTimeMillis()).apply();
        } catch (Exception ignored) {}
    }

    private static Bitmap pic(Context ctx, String host) {
        if (!host.equals(prefs(ctx).getString("picHost", ""))) return null;
        File f = picFile(ctx);
        return f.exists() ? BitmapFactory.decodeFile(f.getPath()) : null;
    }

    static boolean active(JSONObject st) {
        String s = st == null ? "" : st.optString("s");
        return "printing".equals(s) || "paused".equals(s) || "preparing".equals(s) || "selftest".equals(s);
    }

    /* ---------------- обновление по сети ---------------- */

    private void refreshAsync(Context ctx, String cmd, int val) {
        final PendingResult res = goAsync();
        final Context app = ctx.getApplicationContext();
        prefs(app).edit().putBoolean("busy", true).apply();
        renderAll(app);
        new Thread(() -> {
            try { refreshNow(app, cmd, val); }
            finally { prefs(app).edit().putBoolean("busy", false).apply(); renderAll(app); res.finish(); }
        }).start();
    }

    static void refreshNow(Context ctx, String cmd, int val) {
        JSONObject P = printer(ctx);
        if (P == null) return;
        String host = P.optString("host"), type = P.optString("type", "creality");
        SharedPreferences p = prefs(ctx);
        try {
            if (cmd != null) {
                if (P.optBoolean("ctl", true)) {
                    PrinterNet.command(type, host, cmd, val);
                    Thread.sleep(1200);
                } else {
                    p.edit().putString("err", "Управление выключено в настройках принтера").apply();
                    return;
                }
            }
            JSONObject v = PrinterNet.status(type, host);
            saveState(ctx, host, v);
            // снимок обновляем не чаще раза в минуту — он тяжелее остального
            if (cmd == null || System.currentTimeMillis() - p.getLong("picAt", 0) > 60000) {
                Bitmap b = PrinterNet.picture(type, host, v.optString("cam"), !v.optString("file").isEmpty() && !"idle".equals(v.optString("s")));
                if (b != null || !"webrtc".equals(v.optString("cam"))) savePic(ctx, host, b);
            }
            schedule(ctx, v);
        } catch (Exception e) {
            p.edit().putString("err", "Нет связи с принтером").apply();
        }
    }

    /** Пока печать идёт — запланировать следующее обновление; иначе хватает системного раза в 30 минут. */
    static void schedule(Context ctx, JSONObject v) {
        AlarmManager am = alarm(ctx);
        PendingIntent pi = pi(ctx, A_REFRESH, 1);
        if (active(v) && ids(ctx).length > 0) am.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + ACTIVE_EVERY, pi);
        else am.cancel(pi);
    }

    /* ---------------- отрисовка ---------------- */

    static int[] ids(Context ctx) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, PrinterWidget.class));
    }

    static void renderAll(Context ctx) {
        int[] ids = ids(ctx);
        if (ids.length == 0) return;
        RemoteViews rv = build(ctx);
        AppWidgetManager.getInstance(ctx).updateAppWidget(ids, rv);
    }

    private static AlarmManager alarm(Context ctx) { return (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE); }

    private static PendingIntent pi(Context ctx, String action, int code) {
        Intent i = new Intent(ctx, PrinterWidget.class).setAction(action);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent open(Context ctx, String what, int code) {
        Intent i = new Intent(ctx, MainActivity.class).setAction(Intent.ACTION_VIEW)
                .putExtra(EXTRA_OPEN, what).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static final String CLOUD_PKG = "com.cxsw.sdprinter";

    /** Creality Cloud — для управления не из дома. Не установлен → страница в Google Play. */
    static Intent cloudIntent(Context ctx) {
        Intent i = ctx.getPackageManager().getLaunchIntentForPackage(CLOUD_PKG);
        if (i == null) i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("market://details?id=" + CLOUD_PKG));
        return i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    static String tfmt(double sec) {
        long s = Math.max(0, Math.round(sec)), h = s / 3600, m = s % 3600 / 60;
        return h > 0 ? h + " ч " + m + " мин" : m > 0 ? m + " мин" : s + " с";
    }

    private static String deg(JSONObject v, String k) {
        return v.has(k) ? Math.round(v.optDouble(k)) + "°" : "—";
    }

    private static String stateText(String s) {
        switch (s) {
            case "printing": return "🟢 Печатает";
            case "preparing": return "🟡 Готовится";
            case "paused": return "⏸️ Пауза";
            case "done": return "✅ Готово";
            case "stopped": return "⏹️ Остановлена";
            case "error": return "🔴 Ошибка";
            case "selftest": return "🔧 Самопроверка";
            default: return "⚪ Свободен";
        }
    }

    static RemoteViews build(Context ctx) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_printer);
        SharedPreferences p = prefs(ctx);
        JSONObject P = printer(ctx);
        rv.setOnClickPendingIntent(R.id.w_root, open(ctx, "printer", 10));
        if (P == null) {
            rv.setTextViewText(R.id.w_name, "3D Помощник");
            rv.setTextViewText(R.id.w_state, "Принтер не добавлен");
            rv.setTextViewText(R.id.w_file, "Нажми, чтобы добавить принтер в приложении");
            for (int id : new int[]{R.id.w_prog, R.id.w_line, R.id.w_temps, R.id.w_buttons, R.id.w_pic, R.id.w_upd})
                rv.setViewVisibility(id, View.GONE);
            return rv;
        }
        String host = P.optString("host");
        JSONObject v = state(ctx);
        boolean busy = p.getBoolean("busy", false);
        String err = p.getString("err", null);

        rv.setTextViewText(R.id.w_name, P.optString("n", "").isEmpty() ? host : P.optString("n"));
        rv.setViewVisibility(R.id.w_upd, View.VISIBLE);
        String upd;
        if (busy) upd = "обновляю…";
        else if (err != null) upd = "⚠ " + err;
        else if (v != null) upd = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(v.optLong("at")));
        else upd = "";
        rv.setTextViewText(R.id.w_upd, upd);

        if (v == null) {
            rv.setTextViewText(R.id.w_state, busy ? "Подключаюсь…" : "Нет данных");
            rv.setTextViewText(R.id.w_file, "Телефон должен быть в той же Wi-Fi сети, что и принтер");
            rv.setViewVisibility(R.id.w_prog, View.GONE);
            rv.setViewVisibility(R.id.w_line, View.GONE);
            rv.setViewVisibility(R.id.w_temps, View.GONE);
        } else {
            String s = v.optString("s", "idle");
            boolean job = active(v) || "done".equals(s);
            rv.setTextViewText(R.id.w_state, stateText(s));
            rv.setTextViewText(R.id.w_file, job ? v.optString("file") : "");
            rv.setViewVisibility(R.id.w_file, job && !v.optString("file").isEmpty() ? View.VISIBLE : View.GONE);
            double prog = v.optDouble("prog", 0);
            if (Double.isNaN(prog)) prog = 0;
            rv.setViewVisibility(R.id.w_prog, job ? View.VISIBLE : View.GONE);
            rv.setProgressBar(R.id.w_prog, 1000, (int) Math.round(Math.min(100, prog) * 10), false);
            String line = (int) Math.floor(prog) + " %";
            double left = v.optDouble("left", 0);
            if ("printing".equals(s) && left > 0) {
                String eta = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(System.currentTimeMillis() + (long) (left * 1000)));
                line += " · ещё " + tfmt(left) + " · к " + eta;
            }
            rv.setTextViewText(R.id.w_line, line);
            rv.setViewVisibility(R.id.w_line, job ? View.VISIBLE : View.GONE);
            rv.setViewVisibility(R.id.w_temps, View.VISIBLE);
            rv.setTextViewText(R.id.w_temps, "Сопло " + deg(v, "noz") + (v.has("nozT") && v.optDouble("nozT") > 0 ? " / " + deg(v, "nozT") : "")
                    + "   Стол " + deg(v, "bed") + (v.has("bedT") && v.optDouble("bedT") > 0 ? " / " + deg(v, "bedT") : ""));
        }

        Bitmap b = pic(ctx, host);
        rv.setViewVisibility(R.id.w_pic, b != null ? View.VISIBLE : View.GONE);
        if (b != null) rv.setImageViewBitmap(R.id.w_pic, b);

        // кнопки
        rv.setViewVisibility(R.id.w_buttons, View.VISIBLE);
        rv.setOnClickPendingIntent(R.id.w_refresh, pi(ctx, A_REFRESH, 2));
        // принтер не отвечает (скорее всего, мы не дома) → вместо камеры кнопка Creality Cloud
        boolean away = err != null && "creality".equals(P.optString("type", "creality"));
        if (away) {
            rv.setTextViewText(R.id.w_cam, "☁ Cloud");
            rv.setOnClickPendingIntent(R.id.w_cam, PendingIntent.getActivity(ctx, 12, cloudIntent(ctx),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        } else {
            rv.setTextViewText(R.id.w_cam, "📷 Камера");
            rv.setOnClickPendingIntent(R.id.w_cam, open(ctx, "cam", 11));
        }
        boolean ctl = P.optBoolean("ctl", true) && v != null;
        String s = v == null ? "" : v.optString("s");
        boolean light = ctl && v.has("light");
        rv.setViewVisibility(R.id.w_light, light ? View.VISIBLE : View.GONE);
        if (light) {
            rv.setTextViewText(R.id.w_light, v.optBoolean("light") ? "💡 Выкл." : "💡 Вкл.");
            rv.setOnClickPendingIntent(R.id.w_light, pi(ctx, A_LIGHT, 3));
        }
        boolean canPause = ctl && ("printing".equals(s) || "preparing".equals(s));
        boolean canResume = ctl && "paused".equals(s);
        rv.setViewVisibility(R.id.w_pause, canPause || canResume ? View.VISIBLE : View.GONE);
        if (canPause) {
            boolean armed = System.currentTimeMillis() < p.getLong("armUntil", 0);
            rv.setTextViewText(R.id.w_pause, armed ? "Точно? ⏸" : "⏸ Пауза");
            rv.setInt(R.id.w_pause, "setBackgroundResource", armed ? R.drawable.widget_btn_warn : R.drawable.widget_btn);
            rv.setOnClickPendingIntent(R.id.w_pause, pi(ctx, A_PAUSE, 4));
        } else if (canResume) {
            rv.setTextViewText(R.id.w_pause, "▶ Дальше");
            rv.setInt(R.id.w_pause, "setBackgroundResource", R.drawable.widget_btn_acc);
            rv.setOnClickPendingIntent(R.id.w_pause, pi(ctx, A_RESUME, 5));
        }
        return rv;
    }
}
