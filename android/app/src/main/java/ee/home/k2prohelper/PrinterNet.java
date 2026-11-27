package ee.home.k2prohelper;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Iterator;

/**
 * Связь с принтером для виджета — без WebView, прямо из Android.
 * Creality K1/K2/Hi: родной WebSocket ws://IP:9999 (тот же, что в приложении, см. www/js/printer.js).
 * Klipper: HTTP Moonraker на порту 7125.
 * Возвращает то же «нормализованное» состояние, что и crealityView()/moonView() в приложении.
 */
final class PrinterNet {
    private PrinterNet() {}

    static final int TIMEOUT = 4000;

    /* ---------------- состояние ---------------- */

    static JSONObject status(String type, String host) throws Exception {
        return "moonraker".equals(type) ? moonStatus(host) : crealityStatus(host);
    }

    private static JSONObject crealityStatus(String host) throws Exception {
        JSONObject d = new JSONObject();
        Ws ws = Ws.open(host);
        try {
            ws.sendText("{\"method\":\"get\",\"params\":{\"ReqPrinterPara\":1}}");
            long end = System.currentTimeMillis() + 3500;
            while (System.currentTimeMillis() < end) {
                String m;
                try { m = ws.readText(); } catch (SocketTimeoutException e) { break; }
                if (m == null) break;
                if (m.isEmpty() || "ok".equals(m) || m.charAt(0) != '{') continue;
                JSONObject o;
                try { o = new JSONObject(m); } catch (Exception e) { continue; }
                if (o.has("ModeCode")) continue;
                for (Iterator<String> it = o.keys(); it.hasNext(); ) { String k = it.next(); d.put(k, o.get(k)); }
                // полный кадр пришёл — дальше ждать нечего
                if (d.has("state") && d.has("nozzleTemp") && d.has("bedTemp0")) break;
            }
        } finally { ws.close(); }
        if (d.length() == 0) throw new IOException("Принтер не прислал данные");
        return crealityView(d);
    }

    private static double n(JSONObject d, String k) {
        Object v = d.opt(k);
        if (v == null || v == JSONObject.NULL) return Double.NaN;
        try { return Double.parseDouble(String.valueOf(v)); } catch (Exception e) { return Double.NaN; }
    }

    private static void put(JSONObject o, String k, double v) throws Exception { if (!Double.isNaN(v)) o.put(k, v); }

    static JSONObject crealityView(JSONObject d) throws Exception {
        double prog = !Double.isNaN(n(d, "printProgress")) ? n(d, "printProgress") : n(d, "dProgress");
        double st = n(d, "state");
        String file = d.optString("printFileName", "");
        Object e = d.opt("err");
        int err = e instanceof JSONObject ? ((JSONObject) e).optInt("errcode", 0) : (int) (Double.isNaN(n(d, "err")) ? 0 : n(d, "err"));
        boolean paused = st == 5 || n(d, "pause") == 1 || n(d, "paused") == 1 || n(d, "isPaused") == 1;
        boolean has = !file.isEmpty();
        double self = n(d, "withSelfTest");
        String s = "idle";
        if (self > 0 && self < 100) s = "selftest";
        else if (err != 0) s = "error";
        else if (paused && has) s = "paused";
        else if (st == 1 && has) s = prog >= 100 ? "done" : "printing";
        else if ((st == 0 || st == 7 || st == 9) && has) s = prog >= 100 ? "done" : "preparing";
        else if (st == 2 || (has && prog >= 100)) s = "done";
        else if (st == 4) s = "stopped";
        JSONObject v = new JSONObject();
        v.put("s", s);
        v.put("file", file.substring(file.lastIndexOf('/') + 1));
        put(v, "prog", prog);
        double left = !Double.isNaN(n(d, "printLeftTime")) ? n(d, "printLeftTime") : n(d, "printTimeLeft");
        put(v, "left", left);
        put(v, "elapsed", n(d, "printJobTime"));
        put(v, "mm", n(d, "usedMaterialLength"));
        put(v, "noz", n(d, "nozzleTemp"));
        put(v, "nozT", n(d, "targetNozzleTemp"));
        put(v, "bed", n(d, "bedTemp0"));
        put(v, "bedT", n(d, "targetBedTemp0"));
        put(v, "box", n(d, "boxTemp"));
        if (d.has("lightSw")) v.put("light", n(d, "lightSw") == 1);
        v.put("err", err);
        String model = d.optString("model", "");
        boolean webrtc = n(d, "webrtcSupport") == 1 || model.matches("F008|F012|F021") || model.toLowerCase().contains("k2");
        v.put("cam", webrtc ? "webrtc" : "mjpeg");
        return v;
    }

    private static JSONObject moonStatus(String host) throws Exception {
        String q = "print_stats&display_status&virtual_sdcard&extruder&heater_bed";
        JSONObject r = new JSONObject(httpText("http://" + host + ":7125/printer/objects/query?" + q, "GET"))
                .getJSONObject("result").getJSONObject("status");
        JSONObject ps = r.optJSONObject("print_stats"), ds = r.optJSONObject("display_status"),
                vs = r.optJSONObject("virtual_sdcard"), ex = r.optJSONObject("extruder"), hb = r.optJSONObject("heater_bed");
        if (ps == null) ps = new JSONObject();
        double p = ds != null && n(ds, "progress") > 0 ? n(ds, "progress") : (vs != null && !Double.isNaN(n(vs, "progress")) ? n(vs, "progress") : 0);
        String state = ps.optString("state", "standby");
        String s;
        switch (state) {
            case "printing": s = "printing"; break;
            case "paused": s = "paused"; break;
            case "complete": s = "done"; break;
            case "cancelled": s = "stopped"; break;
            case "error": s = "error"; break;
            default: s = "idle";
        }
        double el = n(ps, "print_duration");
        JSONObject v = new JSONObject();
        v.put("s", s);
        String file = ps.optString("filename", "");
        v.put("file", file.substring(file.lastIndexOf('/') + 1));
        v.put("prog", Math.round(p * 1000) / 10.0);
        if (p > 0.02 && el > 0) v.put("left", el / p - el);
        put(v, "elapsed", el);
        put(v, "mm", n(ps, "filament_used"));
        if (ex != null) { put(v, "noz", n(ex, "temperature")); put(v, "nozT", n(ex, "target")); }
        if (hb != null) { put(v, "bed", n(hb, "temperature")); put(v, "bedT", n(hb, "target")); }
        v.put("err", "error".equals(state) ? 1 : 0);
        v.put("cam", "moon");
        return v;
    }

    /* ---------------- команды ---------------- */

    /** kind: pause | resume | light (val = 1/0). Остановку печати с виджета не делаем — только из приложения с подтверждением. */
    static void command(String type, String host, String kind, int val) throws Exception {
        if ("moonraker".equals(type)) {
            String base = "http://" + host + ":7125";
            if ("pause".equals(kind)) httpText(base + "/printer/print/pause", "POST");
            else if ("resume".equals(kind)) httpText(base + "/printer/print/resume", "POST");
            return;
        }
        String params;
        if ("pause".equals(kind)) params = "{\"pause\":1}";
        else if ("resume".equals(kind)) params = "{\"pause\":0}";
        else if ("light".equals(kind)) params = "{\"lightSw\":" + (val != 0 ? 1 : 0) + "}";
        else return;
        Ws ws = Ws.open(host);
        try {
            ws.sendText("{\"method\":\"set\",\"params\":" + params + "}");
            // даём принтеру принять команду до закрытия соединения
            try { ws.readText(); } catch (Exception ignored) {}
        } finally { ws.close(); }
    }

    /* ---------------- картинка ---------------- */

    /** Снимок с камеры, если он доступен по HTTP; иначе — превью текущей модели (Creality). */
    static Bitmap picture(String type, String host, String cam, boolean job) {
        try {
            if ("moonraker".equals(type)) {
                JSONArray L = new JSONObject(httpText("http://" + host + ":7125/server/webcams/list", "GET"))
                        .getJSONObject("result").getJSONArray("webcams");
                for (int i = 0; i < L.length(); i++) {
                    JSONObject w = L.getJSONObject(i);
                    if (!w.optBoolean("enabled", true)) continue;
                    String u = w.optString("snapshot_url", "");
                    if (u.isEmpty()) continue;
                    if (!u.startsWith("http")) u = "http://" + host + (u.startsWith("/") ? "" : "/") + u;
                    Bitmap b = bitmap(u);
                    if (b != null) return b;
                }
                return null;
            }
            if (!"webrtc".equals(cam)) {
                Bitmap b = bitmap("http://" + host + ":8080/?action=snapshot");
                if (b != null) return b;
            }
            if (job) return bitmap("http://" + host + "/downloads/original/current_print_image.png");
        } catch (Exception ignored) {}
        return null;
    }

    private static Bitmap bitmap(String url) {
        try {
            byte[] data = httpBytes(url, "GET");
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(data, 0, data.length, o);
            if (o.outWidth <= 0) return null;
            // виджету хватает ~400 px, а большие картинки не пролезут через RemoteViews
            int ss = 1;
            while (Math.max(o.outWidth, o.outHeight) / (ss * 2) >= 400) ss *= 2;
            o = new BitmapFactory.Options();
            o.inSampleSize = ss;
            return BitmapFactory.decodeByteArray(data, 0, data.length, o);
        } catch (Exception e) { return null; }
    }

    /* ---------------- HTTP ---------------- */

    static String httpText(String url, String method) throws IOException {
        return new String(httpBytes(url, method), StandardCharsets.UTF_8);
    }

    static byte[] httpBytes(String url, String method) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(TIMEOUT);
            c.setReadTimeout(TIMEOUT);
            c.setRequestMethod(method);
            if ("POST".equals(method)) { c.setDoOutput(true); c.getOutputStream().close(); }
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) throw new IOException("HTTP " + code);
            try (InputStream in = c.getInputStream()) { return readAll(in, 4 << 20); }
        } finally { c.disconnect(); }
    }

    private static byte[] readAll(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int r;
        while ((r = in.read(buf)) > 0) {
            out.write(buf, 0, r);
            if (out.size() > max) throw new IOException("Слишком большой ответ");
        }
        return out.toByteArray();
    }

    /* ---------------- минимальный WebSocket-клиент ---------------- */

    static final class Ws {
        private final Socket sock;
        private final InputStream in;
        private final OutputStream out;
        private static final SecureRandom RND = new SecureRandom();

        private Ws(Socket s) throws IOException { sock = s; in = s.getInputStream(); out = s.getOutputStream(); }

        static Ws open(String host) throws IOException {
            try { return open(host, true); }
            // часть прошивок не подтверждает подпротокол «wsslicer» — пробуем без него
            catch (IOException e) { return open(host, false); }
        }

        private static Ws open(String host, boolean proto) throws IOException {
            Socket s = new Socket();
            try {
                s.connect(new InetSocketAddress(host, 9999), TIMEOUT);
                s.setSoTimeout(TIMEOUT);
                byte[] k = new byte[16];
                RND.nextBytes(k);
                String req = "GET / HTTP/1.1\r\nHost: " + host + ":9999\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        + "Sec-WebSocket-Key: " + Base64.encodeToString(k, Base64.NO_WRAP) + "\r\nSec-WebSocket-Version: 13\r\n"
                        + (proto ? "Sec-WebSocket-Protocol: wsslicer\r\n" : "") + "\r\n";
                Ws ws = new Ws(s);
                ws.out.write(req.getBytes(StandardCharsets.US_ASCII));
                ws.out.flush();
                String status = ws.line();
                if (status == null || !status.contains(" 101")) throw new IOException("Принтер отказал в подключении");
                String l;
                while ((l = ws.line()) != null && !l.isEmpty()) { /* заголовки ответа не нужны */ }
                return ws;
            } catch (IOException e) {
                try { s.close(); } catch (IOException ignored) {}
                throw e;
            }
        }

        private String line() throws IOException {
            StringBuilder b = new StringBuilder();
            int c;
            while ((c = in.read()) != -1) {
                if (c == '\n') return b.toString().trim();
                b.append((char) c);
                if (b.length() > 8192) throw new IOException("Странный ответ");
            }
            return b.length() > 0 ? b.toString() : null;
        }

        void sendText(String s) throws IOException { frame(0x1, s.getBytes(StandardCharsets.UTF_8)); }

        private synchronized void frame(int opcode, byte[] p) throws IOException {
            ByteArrayOutputStream f = new ByteArrayOutputStream();
            f.write(0x80 | opcode);
            if (p.length < 126) f.write(0x80 | p.length);
            else if (p.length < 65536) { f.write(0x80 | 126); f.write(p.length >> 8); f.write(p.length & 0xff); }
            else { f.write(0x80 | 127); for (int i = 7; i >= 0; i--) f.write((int) (((long) p.length >> (8 * i)) & 0xff)); }
            byte[] m = new byte[4];
            RND.nextBytes(m);
            f.write(m);
            for (int i = 0; i < p.length; i++) f.write(p[i] ^ m[i & 3]);
            out.write(f.toByteArray());
            out.flush();
        }

        private int rd() throws IOException { int c = in.read(); if (c < 0) throw new IOException("Соединение закрыто"); return c; }

        /** Следующее текстовое сообщение; null — принтер закрыл соединение. */
        String readText() throws IOException {
            ByteArrayOutputStream msg = new ByteArrayOutputStream();
            while (true) {
                int b0 = rd(), b1 = rd();
                int op = b0 & 0x0f;
                long len = b1 & 0x7f;
                if (len == 126) len = (rd() << 8) | rd();
                else if (len == 127) { len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | rd(); }
                byte[] mask = null;
                if ((b1 & 0x80) != 0) { mask = new byte[4]; for (int i = 0; i < 4; i++) mask[i] = (byte) rd(); }
                if (len > (8 << 20)) throw new IOException("Слишком большое сообщение");
                byte[] p = new byte[(int) len];
                int off = 0;
                while (off < p.length) { int r = in.read(p, off, p.length - off); if (r < 0) throw new IOException("Соединение закрыто"); off += r; }
                if (mask != null) for (int i = 0; i < p.length; i++) p[i] ^= mask[i & 3];
                if (op == 0x8) return null;
                if (op == 0x9) { frame(0xA, p); continue; }
                if (op == 0xA) continue;
                msg.write(p);
                if ((b0 & 0x80) != 0) return new String(msg.toByteArray(), StandardCharsets.UTF_8);
            }
        }

        void close() {
            try { frame(0x8, new byte[0]); } catch (Exception ignored) {}
            try { sock.close(); } catch (Exception ignored) {}
        }
    }
}
