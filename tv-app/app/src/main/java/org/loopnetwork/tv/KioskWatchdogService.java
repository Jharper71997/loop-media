package org.loopnetwork.tv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
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

    /**
     * Relaunch the player the instant the display comes back.
     *
     * The watchdog tick below only fires while the device is awake enough to run
     * our handler, and after a Fire OS standby or an overnight OS update reboot
     * it is the Fire TV home screen that comes back, not us. ACTION_SCREEN_ON is the earliest signal that the display is
     * live again, and a start from a broadcast receiver is exempt from some of
     * the background-activity-launch restrictions that block the tick on newer
     * Fire OS. ACTION_SCREEN_ON and ACTION_SCREEN_OFF cannot be declared in the
     * manifest, so this is registered at runtime and the service is START_STICKY
     * so it outlives the activity.
     */
    private final BroadcastReceiver wake = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            try {
                Intent launch = new Intent(c, MainActivity.class);
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                c.startActivity(launch);
            } catch (Exception ignored) {}
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        startForeground(NOTIF_ID, buildNotification());
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_USER_PRESENT);
        f.addAction("android.intent.action.DREAMING_STOPPED");
        try {
            registerReceiver(wake, f);
        } catch (Exception ignored) {}
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
                    // MainActivity is launchMode=singleTask, so NEW_TASK reuses
                    // the existing instance and pulls its whole task to the front
                    // in one shot. We deliberately do NOT add REORDER_TO_FRONT:
                    // since our activity is already the top of its backgrounded
                    // task, that flag makes the first several starts no-op (the
                    // task never comes forward) and the bounce-back drags out to
                    // several seconds on Fire OS. SINGLE_TOP routes the relaunch
                    // through onNewIntent instead of recreating the WebView.
                    Intent i = new Intent(KioskWatchdogService.this, MainActivity.class);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
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
        // A sleeping panel looks exactly like a Home press from here: the activity
        // is paused either way. Pulling it forward would relaunch an activity that
        // carries FLAG_TURN_SCREEN_ON and light the TV back up — so the watchdog
        // would undo every scheduled sleep, seconds after it happened.
        if (ScreenPower.isAsleep(this)) return false;
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
        try {
            unregisterReceiver(wake);
        } catch (Exception ignored) {}
        running = false;
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
