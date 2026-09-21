package org.loopnetwork.tv;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.PowerManager;
import android.text.TextUtils;

/**
 * Turning this screen's panel off and on — on a schedule, or on command.
 *
 * Why any of this exists: a venue's router NATs the screen, so nothing can dial
 * in to it. Every remote fix before this one meant driving to the bar. The player
 * polls the server every ~30s, so a command can ride down on that poll — but the
 * moment the panel is off, the player is paused and that channel is gone. So the
 * native side owns everything that has to work while the screen is dark: the
 * alarms that wake it for opening time, and the once-a-minute "should I wake?"
 * question in {@link PowerAlarmReceiver}.
 *
 * Two ways to darken a panel, and which one you get depends on provisioning:
 *   • device owner (adb shell dpm set-device-owner …) → {@code lockNow()}, a real
 *     display-off.
 *   • otherwise → black overlay at minimum backlight. The room sees a dark
 *     screen; the panel is still lit and still drawing power. The player says so
 *     in its ack rather than letting a half-measure report as success.
 */
final class ScreenPower {

    private static final String PREFS = "power";
    private static final String KEY_DEVICE = "device_id";
    private static final String KEY_SECRET = "device_secret";
    private static final String KEY_SCHEDULE = "schedule_json";
    private static final String KEY_ASLEEP = "asleep";

    static final String ACTION_EDGE = "org.loopnetwork.tv.POWER_EDGE";
    static final String ACTION_CHECK = "org.loopnetwork.tv.POWER_CHECK";

    /** How often a sleeping screen asks the server whether it should wake. One
     *  minute: slow enough to be free, fast enough that "turn it on" from the
     *  admin feels like a button rather than a maintenance window. */
    static final long CHECK_INTERVAL_MS = 60_000L;

    private ScreenPower() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---- identity + schedule, handed down by the page ----------------------

    /** The player knows the device id (it lives in the WebView's localStorage);
     *  the shell needs its own copy, because while the panel is off the page is
     *  paused and can't be asked. */
    static void setDevice(Context ctx, String deviceId, String secret) {
        prefs(ctx).edit()
                .putString(KEY_DEVICE, deviceId == null ? "" : deviceId)
                .putString(KEY_SECRET, secret == null ? "" : secret)
                .apply();
    }

    static String deviceId(Context ctx) { return prefs(ctx).getString(KEY_DEVICE, ""); }

    static String deviceSecret(Context ctx) { return prefs(ctx).getString(KEY_SECRET, ""); }

    static PowerSchedule schedule(Context ctx) {
        return PowerSchedule.parse(prefs(ctx).getString(KEY_SCHEDULE, ""));
    }

    /** Store the schedule from the latest /api/tv/loop poll and re-arm. Cheap and
     *  idempotent, so the player can hand it over on every poll without thinking
     *  about whether it changed. */
    static void setSchedule(Context ctx, String json) {
        String previous = prefs(ctx).getString(KEY_SCHEDULE, "");
        if (TextUtils.equals(previous, json)) return; // the normal case, every 30s
        prefs(ctx).edit().putString(KEY_SCHEDULE, json == null ? "" : json).apply();
        arm(ctx, true);
    }

    static boolean isAsleep(Context ctx) { return prefs(ctx).getBoolean(KEY_ASLEEP, false); }

    private static void setAsleep(Context ctx, boolean v) {
        prefs(ctx).edit().putBoolean(KEY_ASLEEP, v).apply();
    }

    // ---- the two actions ---------------------------------------------------

    /**
     * Darken the panel.
     *
     * @return true if the display was genuinely powered down (device owner),
     *         false if the screen only went black at minimum backlight — the
     *         caller reports the difference rather than hiding it.
     */
    static boolean sleepNow(Context ctx) {
        setAsleep(ctx, true);
        armCheck(ctx);
        MainActivity act = MainActivity.current;
        // The app holds a screen-bright wake lock to keep the panel up 24/7; it
        // has to let go first, whichever way we darken the screen.
        if (act != null) act.releaseScreenLock();
        DevicePolicyManager dpm =
                (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
        ComponentName admin = new ComponentName(ctx.getApplicationContext(), KioskAdminReceiver.class);
        try {
            if (dpm != null && dpm.isAdminActive(admin)) {
                dpm.lockNow();
                // Deliberately NO black sheet on this path: the display is
                // genuinely off, and a host who wakes the TV with the remote at
                // 3am should find the player, not a black rectangle that looks
                // like a broken screen.
                return true;
            }
        } catch (Exception ignored) {}
        if (act != null) act.setDark(true);
        return false;
    }

    /** Light the panel and put the kiosk back in front of it. Safe to call when
     *  already awake — that is the normal case for a wake command that arrives
     *  while the screen is running. */
    static void wakeNow(Context ctx) {
        setAsleep(ctx, false);
        cancelCheck(ctx);
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                @SuppressWarnings("deprecation")
                PowerManager.WakeLock wl = pm.newWakeLock(
                        PowerManager.FULL_WAKE_LOCK
                                | PowerManager.ACQUIRE_CAUSES_WAKEUP
                                | PowerManager.ON_AFTER_RELEASE,
                        "loopnetwork:wake");
                // Timed so a crash between here and the activity starting can
                // never leave a lock held forever.
                wl.acquire(15_000L);
            }
        } catch (Exception ignored) {}
        MainActivity act = MainActivity.current;
        if (act != null) {
            act.setDark(false);
            act.reacquireScreenLock();
        }
        // Start the activity regardless: after a real display-off the launcher is
        // often what comes back, and the point of waking is the ad, not the Fire
        // TV home screen. MainActivity is singleTask, so this is a no-op reorder
        // when it is already in front.
        try {
            Intent i = new Intent(ctx.getApplicationContext(), MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP
                    | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            ctx.getApplicationContext().startActivity(i);
        } catch (Exception ignored) {}
    }

    /** Put the panel back where the schedule says it belongs, whatever woke it.
     *  Unlike {@link #arm}, this does not trust the stored asleep flag: after a
     *  host wakes a sleeping TV with the remote, the flag still says asleep while
     *  the panel is plainly lit, and only re-issuing the sleep fixes that. */
    static void resettle(Context ctx) {
        PowerSchedule s = schedule(ctx);
        if (!s.enabled) return;
        if (s.isOpenAt(System.currentTimeMillis())) wakeNow(ctx);
        else sleepNow(ctx);
    }

    // ---- alarms ------------------------------------------------------------

    /**
     * Put the screen in the state its schedule calls for, and set the alarm for
     * the next change.
     *
     * @param act true to act on the current state now (the schedule changed, or
     *            we just booted); false to only re-arm the alarm.
     */
    static void arm(Context ctx, boolean act) {
        PowerSchedule s = schedule(ctx);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent edge = pending(ctx, ACTION_EDGE, 1001);

        if (!s.enabled) {
            am.cancel(edge);
            cancelCheck(ctx);
            // A screen that was sleeping when the schedule was switched off must
            // not stay dark waiting for an open time it no longer has.
            if (isAsleep(ctx)) wakeNow(ctx);
            return;
        }

        long now = System.currentTimeMillis();
        boolean open = s.isOpenAt(now);
        if (act) {
            if (open && isAsleep(ctx)) wakeNow(ctx);
            else if (!open && !isAsleep(ctx)) sleepNow(ctx);
        }

        long next = s.nextChangeAfter(now);
        if (next <= 0) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                    // Exact alarms withheld (Android 12+ without the permission):
                    // an inexact one can drift by minutes, which is survivable for
                    // a bar's opening hour and better than no schedule at all.
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, edge);
                } else {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, edge);
                }
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, next, edge);
            }
        } catch (Exception ignored) {}
    }

    /** While asleep, ask the server once a minute whether to wake. This is the
     *  only inbound path a dark screen has. */
    static void armCheck(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = System.currentTimeMillis() + CHECK_INTERVAL_MS;
        PendingIntent check = pending(ctx, ACTION_CHECK, 1002);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, check);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, at, check);
            }
        } catch (Exception ignored) {}
    }

    static void cancelCheck(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            try { am.cancel(pending(ctx, ACTION_CHECK, 1002)); } catch (Exception ignored) {}
        }
    }

    private static PendingIntent pending(Context ctx, String action, int code) {
        Intent i = new Intent(ctx.getApplicationContext(), PowerAlarmReceiver.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx.getApplicationContext(), code, i, flags);
    }
}
