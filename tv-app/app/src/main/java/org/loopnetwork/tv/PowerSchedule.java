package org.loopnetwork.tv;

import android.text.TextUtils;

import org.json.JSONObject;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * The venue's open hours, as the screen understands them.
 *
 * Handed down by /api/tv/loop (migration 0078) in the shape
 * {"sleep_when_closed":true,"tz":"America/New_York",
 *  "windows":{"0":{"open":"13:00","close":"22:00"}, …}} — keys '0'..'6', 0=Sunday,
 * a missing day meaning closed all day.
 *
 * Kept as a value object with no Android dependencies beyond parsing so the edge
 * cases that actually bite (an overnight window, a DST boundary, a venue closed
 * Mondays) are decided in one readable place. The open/closed rule is a
 * deliberate mirror of lib/openHours.ts on the server: the same instant must not
 * read as open on the server and closed on the glass.
 */
final class PowerSchedule {

    /** Nothing is scheduled unless the screen was opted in on the admin page. */
    final boolean enabled;
    final TimeZone tz;
    /** Minutes past local midnight; CLOSED for a day the venue does not open. */
    private static final int CLOSED = -1;
    private final int[] open = new int[7];
    private final int[] close = new int[7];

    private PowerSchedule(boolean enabled, TimeZone tz, int[] open, int[] close) {
        this.enabled = enabled;
        this.tz = tz;
        System.arraycopy(open, 0, this.open, 0, 7);
        System.arraycopy(close, 0, this.close, 0, 7);
    }

    /** A schedule that never sleeps: what an un-opted-in screen (and any parse
     *  failure) must fall back to. Staying lit is the safe direction — a screen
     *  dark during business hours is a refund; a screen lit overnight is a bill. */
    static PowerSchedule alwaysOn() {
        int[] none = new int[7];
        for (int i = 0; i < 7; i++) none[i] = CLOSED;
        return new PowerSchedule(false, TimeZone.getDefault(), none, none);
    }

    static PowerSchedule parse(String json) {
        if (TextUtils.isEmpty(json)) return alwaysOn();
        try {
            JSONObject o = new JSONObject(json);
            if (!o.optBoolean("sleep_when_closed", false)) return alwaysOn();
            TimeZone tz = TextUtils.isEmpty(o.optString("tz"))
                    ? TimeZone.getDefault()
                    : TimeZone.getTimeZone(o.optString("tz"));
            JSONObject w = o.optJSONObject("windows");
            int[] open = new int[7];
            int[] close = new int[7];
            for (int d = 0; d < 7; d++) {
                open[d] = CLOSED;
                close[d] = CLOSED;
                JSONObject day = w == null ? null : w.optJSONObject(String.valueOf(d));
                if (day == null) continue;
                int o1 = toMinutes(day.optString("open"));
                int c1 = toMinutes(day.optString("close"));
                if (o1 >= 0 && c1 >= 0) {
                    open[d] = o1;
                    close[d] = c1;
                }
            }
            // Every day closed is not a schedule, it is a misconfiguration — and
            // obeying it would take the screen dark forever.
            boolean any = false;
            for (int d = 0; d < 7; d++) if (open[d] != CLOSED) any = true;
            if (!any) return alwaysOn();
            return new PowerSchedule(true, tz, open, close);
        } catch (Exception e) {
            return alwaysOn();
        }
    }

    private static int toMinutes(String hhmm) {
        if (TextUtils.isEmpty(hhmm)) return -1;
        String[] parts = hhmm.split(":");
        if (parts.length < 2) return -1;
        try {
            int h = Integer.parseInt(parts[0].trim());
            int m = Integer.parseInt(parts[1].trim());
            if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
            return h * 60 + m;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** Is the venue open at this instant? Mirrors isWithinOpenHours() on the
     *  server, including the overnight case (open 16:00, close 02:00 wraps past
     *  midnight and belongs to the day it OPENED on). */
    boolean isOpenAt(long whenMs) {
        return isOpenAt(whenMs, Calendar.getInstance(tz));
    }

    /** Same test against a Calendar the caller owns, so walking a week doesn't
     *  allocate one per minute on a device with very little to spare. */
    private boolean isOpenAt(long whenMs, Calendar c) {
        if (!enabled) return true;
        c.setTimeInMillis(whenMs);
        int day = c.get(Calendar.DAY_OF_WEEK) - 1; // Calendar.SUNDAY == 1
        int min = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
        if (open[day] == CLOSED) return false;
        int o = open[day];
        int cl = close[day];
        if (cl > o) return min >= o && min < cl;
        return min >= o || min < cl;
    }

    /**
     * When does open/closed next flip? Walked a minute at a time rather than
     * computed, because the arithmetic that looks clever here (next open, unless
     * it already passed, unless the window wraps midnight, unless the clocks went
     * back an hour last night) is exactly where a schedule silently breaks. One
     * cheap loop, run twice a day, is worth more than a proof.
     *
     * @return epoch millis of the change, or -1 if nothing changes within a week
     *         (a venue open 24/7 or closed all week).
     */
    long nextChangeAfter(long fromMs) {
        if (!enabled) return -1;
        Calendar c = Calendar.getInstance(tz);
        boolean now = isOpenAt(fromMs, c);
        long step = 60_000L;
        // Start from the next whole minute so an alarm can't land on the same
        // minute it was armed and fire in a loop.
        long t = fromMs - (fromMs % step) + step;
        long limit = fromMs + 8L * 24 * 60 * 60 * 1000;
        while (t <= limit) {
            if (isOpenAt(t, c) != now) return t;
            t += step;
        }
        return -1;
    }
}
