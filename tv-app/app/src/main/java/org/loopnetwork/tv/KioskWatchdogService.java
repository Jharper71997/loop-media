package org.loopnetwork.tv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;

/**
 * Soft kiosk lock for stock Fire TV, where a true OS lock is impossible.
 *
 * On consumer Fire OS the launcher, the home-starter, and the parental-controls
 * profile owner are all "protected packages": you cannot become device owner,
 * cannot disable the Amazon launcher, and `set-home-activity` is silently
 * ignored. So the Home button always lands on Amazon's home screen and no ADB
 * command changes that. See tv-app/README.md for the full matrix of what was
 * tried.
 *
 * What we CAN do: notice the instant our activity leaves the foreground and
 * immediately bring it back. Press Home and you see the Amazon launcher for
 * about a second, then you're back in the loop. It is not tamper-proof, but for
 * a wall-mounted screen in a bar it is effectively unbreakable by a passerby.
 *
 * This relies on background-activity-launch being permitted, which is true on
 * the device's own OS version being Android 9 (Fire OS 7) or older. Newer Fire
 * OS (Android 10+) restricts it; there the real answer is the Amazon Signage
 * Stick, which does this natively. We degrade gracefully either way — worst
 * case the relaunch no-ops and the app behaves like a normal player.
 *
 * The watchdog stands down whenever an admin has unlocked the screen for
 * maintenance (the same {@code kiosk/unlocked} pref MainActivity uses), so the
 * hidden MENU-x3 menu can still reach Wi-Fi settings without a fight.
 */
public class KioskWatchdogService extends Service {

    private static final String CHANNEL_ID = "loop_kiosk";
    private static final int NOTIF_ID = 42;

    // Poll cheaply; relaunch only after we've been away long enough that this is
    // a real exit (Home press) and not a momentary transition.
    private static final long TICK_MS = 700L;
    private static final long AWAY_GRACE_MS = 1_200L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean running;

    @Override
    public void onCreate() {
        super.onCreate();
        startForeground(NOTIF_ID, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!running) {
            running = true;
            handler.postDelayed(tick, TICK_MS);
        }
        return START_STICKY; // Android restarts us if we're ever killed.
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            try {
                if (!isUnlocked() && shouldPullForward()) {
                    Intent i = new Intent(KioskWatchdogService.this, MainActivity.class);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    startActivity(i);
                }
            } catch (Exception ignored) {
                // A blocked background start on newer Fire OS lands here; ignore
                // and keep polling rather than crashing the service.
            }
            handler.postDelayed(this, TICK_MS);
        }
    };

    /** True when our activity has been out of the foreground longer than grace. */
    private boolean shouldPullForward() {
        if (MainActivity.foreground) return false;
        long away = SystemClock.elapsedRealtime() - MainActivity.lastForegroundAt;
        return away >= AWAY_GRACE_MS;
    }

    private boolean isUnlocked() {
        return getSharedPreferences("kiosk", MODE_PRIVATE).getBoolean("unlocked", false);
    }

    private Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Loop Network kiosk", NotificationManager.IMPORTANCE_MIN);
            ch.setShowBadge(false);
            if (nm != null) nm.createNotificationChannel(ch);
        }
        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return b.setContentTitle("Loop Network")
                .setContentText("Signage running")
                .setSmallIcon(R.drawable.ic_launcher)
                .setOngoing(true)
                .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
