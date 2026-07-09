package org.loopnetwork.tv;

import android.app.admin.DeviceAdminReceiver;

/**
 * Marker admin component. Its only job is to exist so that
 *   adb shell dpm set-device-owner org.loopnetwork.kiosk/org.loopnetwork.tv.KioskAdminReceiver
 * can promote the app to device owner — which is what unlocks kiosk (lock-task)
 * mode, lets the app become the launcher, and exempts the BootReceiver from Fire
 * OS's background-launch limits. No policy callbacks are needed.
 */
public class KioskAdminReceiver extends DeviceAdminReceiver {
}
