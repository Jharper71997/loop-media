package org.loopnetwork.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.text.TextUtils;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

/**
 * The two things that have to happen while the panel is off.
 *
 * ACTION_EDGE  — opening or closing time arrived. Re-read the schedule, sleep or
 *                wake accordingly, arm the next edge.
 * ACTION_CHECK — once a minute while asleep: ask the server whether to wake. The
 *                player can't ask; it is paused behind a dark screen. Without
 *                this, "turn the screen on" from the admin would only ever work
 *                on a screen that was already on.
 *
 * Both run on an alarm rather than a service so a sleeping, dozing Fire TV still
 * hears them.
 */
public class PowerAlarmReceiver extends BroadcastReceiver {

    // Same host the kiosk loads (see MainActivity.TV_URL). Kept explicit rather
    // than derived so a dark screen never depends on the WebView being alive.
    private static final String API_BASE = "https://www.loopnetwork.org";
    private static final int TIMEOUT_MS = 10_000;

    @Override
    public void onReceive(final Context context, Intent intent) {
        final Context app = context.getApplicationContext();
        final String action = intent == null ? null : intent.getAction();
        if (ScreenPower.ACTION_EDGE.equals(action)) {
            // Act on the state the schedule calls for right now, then set the
            // next alarm. Re-evaluating (rather than trusting what the alarm was
            // set for) means a missed or duplicated alarm self-corrects.
            ScreenPower.arm(app, true);
            return;
        }
        if (!ScreenPower.ACTION_CHECK.equals(action)) return;

        if (!ScreenPower.isAsleep(app)) return; // woken by something else meanwhile
        final String device = ScreenPower.deviceId(app);
        if (TextUtils.isEmpty(device)) {
            // Never paired on this shell version, so there is nothing to ask.
            // Keep the loop alive so the screen still wakes on its own edges.
            ScreenPower.armCheck(app);
            return;
        }

        final PendingResult result = goAsync();
        new Thread(new Runnable() {
            @Override public void run() {
                boolean wake = false;
                try {
                    wake = askServer(app, device);
                } catch (Exception ignored) {
                } finally {
                    try {
                        if (wake) ScreenPower.wakeNow(app);
                        // Still asleep? Ask again in a minute. A network failure
                        // is not an answer, so the loop must survive one.
                        else ScreenPower.armCheck(app);
                    } finally {
                        result.finish();
                    }
                }
            }
        }).start();
    }

    /** GET /api/tv/wake — "should I wake up?". Any failure answers no, because a
     *  screen must never wake a bar's TV at 3am on a garbled reply. */
    private static boolean askServer(Context ctx, String device) throws Exception {
        String url = API_BASE + "/api/tv/wake?device=" + URLEncoder.encode(device, "UTF-8");
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        try {
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setRequestProperty("Accept", "application/json");
            String secret = ScreenPower.deviceSecret(ctx);
            if (!TextUtils.isEmpty(secret)) conn.setRequestProperty("x-device-secret", secret);
            if (conn.getResponseCode() != 200) return false;
            StringBuilder sb = new StringBuilder();
            BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
            return new JSONObject(sb.toString()).optBoolean("wake", false);
        } finally {
            conn.disconnect();
        }
    }
}
