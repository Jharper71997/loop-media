package org.loopnetwork.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Relaunch the kiosk automatically after the TV/stick reboots or updates. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Intent launch = new Intent(context, MainActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(launch);

            // Also start the watchdog directly, so the soft kiosk lock is armed
            // even in the window before MainActivity finishes coming up.
            try {
                Intent svc = new Intent(context, KioskWatchdogService.class);
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    context.startForegroundService(svc);
                } else {
                    context.startService(svc);
                }
            } catch (Exception ignored) {}
        }
    }
}
