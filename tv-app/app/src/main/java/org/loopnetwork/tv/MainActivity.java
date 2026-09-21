package org.loopnetwork.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.provider.Settings;
import android.widget.Toast;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * Loop Network TV — a single-purpose kiosk shell around loopnetwork.org/tv.
 *
 * Every piece of signage logic (playlist, pairing by code, heartbeat, offline
 * cache, self-update on new deploy) already lives in the web app. This native
 * shell exists only to run it like a real 24/7 appliance:
 *   - never sleeps (keep-screen-on + CPU + WiFi wake locks)
 *   - never shows Android UI (immersive fullscreen, Back can't exit)
 *   - never needs a human after the pairing code is entered once
 *   - recovers itself from the ways a WebView dies (renderer crash, hang,
 *     white-screen, network loss) so a screen never sits dark needing a
 *     manual restart.
 */
public class MainActivity extends Activity {

    // Use www. explicitly: the apex 308-redirects to www, so hitting the bare
    // host would cost an extra round trip on every load and on every safety
    // reload over days of uptime.
    private static final String TV_URL = "https://www.loopnetwork.org/tv";

    // Foreground state, read by KioskWatchdogService to decide when to pull the
    // app back after a Home press. Static so the service sees it without binding.
    static volatile boolean foreground = false;
    static volatile long lastForegroundAt = 0;

    // The live activity, so an alarm firing behind a dark screen (ScreenPower)
    // can reach the window it needs to darken or light. Null whenever the
    // activity isn't alive, and every caller treats that as "do the part that
    // doesn't need a window".
    static volatile MainActivity current = null;

    // Watchdog: the page pings us through the JS bridge. Hear nothing for this
    // long and the page has hung / white-screened, so reload it.
    private static final long WATCHDOG_TIMEOUT_MS = 90_000L;
    private static final long WATCHDOG_CHECK_MS = 30_000L;
    // Belt-and-suspenders hard reload so nothing drifts over days of uptime.
    private static final long SAFETY_RELOAD_MS = 6 * 60 * 60_000L;

    private FrameLayout root;
    private WebView web;
    // Opaque black sheet over the player, used when the panel can't truly be
    // powered down (no device owner). See setDark().
    private View darkSheet;
    private PowerManager.WakeLock cpuLock;
    private PowerManager.WakeLock screenLock;
    private WifiManager.WifiLock wifiLock;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile long lastAlive;

    // Hidden admin gesture: press the MENU key three times within two seconds.
    private int menuTaps = 0;
    private long firstMenuTapAt = 0;

    // Device-owner kiosk lock. Null-safe: on a stick that was NOT promoted with
    // `adb shell dpm set-device-owner …`, all of this no-ops and the app just
    // runs as a normal foreground player.
    private DevicePolicyManager dpm;
    private ComponentName adminComponent;
    private boolean deviceOwner;
    private static final String KIOSK_PREFS = "kiosk";
    private static final String KEY_UNLOCKED = "unlocked";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Never dim or sleep while the app is foreground. (The TV's own
        // screensaver/auto-power-off must still be disabled in its settings —
        // no app can override that from inside.)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
        // FLAG_KEEP_SCREEN_ON only holds while this window is actually
        // foreground and visible, and it suppresses the screensaver but NOT
        // Amazon device-level inactivity power-off, which is keyed on remote
        // input rather than on the screen being on. The fleet runs Fire TV
        // televisions, so Fire OS owns the panel directly: there is no separate
        // stick and no HDMI-CEC standby involved. When Fire OS powers the panel
        // down, or an overnight OS update reboots it, this activity is paused
        // and nothing here ever brought it back. These flags let the activity
        // wake the display itself when the watchdog relaunches it.
        if (android.os.Build.VERSION.SDK_INT >= 27) {
            setTurnScreenOn(true);
            setShowWhenLocked(true);
        }

        current = this;

        setupKiosk();
        acquireLocks();
        startWatchdog();

        root = new FrameLayout(this);
        setContentView(root);
        buildWebView();

        handleCommandIntent(getIntent());

        // Alarms don't survive a process death any more than a reboot, so re-arm
        // on every cold start and act on the state the schedule calls for: a
        // screen that restarted at 3am should go straight back to sleep, not sit
        // lit until opening time.
        try { ScreenPower.arm(this, true); } catch (Exception ignored) {}

        handler.postDelayed(watchdog, WATCHDOG_CHECK_MS);
        handler.postDelayed(safetyReload, SAFETY_RELOAD_MS);
    }

    /** A command delivered as an intent extra:
     *  {@code am start -n …/.MainActivity --es lm_command sleep}.
     *
     *  The tailnet runner uses this instead of firing a raw key event, because a
     *  key event goes AROUND the app and the app is the thing holding the screen
     *  on. Routed through here, the shell drops its locks first and the panel
     *  stays off. MainActivity is already the exported launcher activity, so
     *  this adds no new way in. */
    private void handleCommandIntent(Intent intent) {
        if (intent == null) return;
        String cmd = intent.getStringExtra("lm_command");
        if (cmd == null) return;
        // Consume it: a singleTask activity is handed the same intent again on
        // every later resume, and a sleep that re-fires on wake is a screen that
        // will not stay on.
        intent.removeExtra("lm_command");
        if ("sleep".equals(cmd)) {
            ScreenPower.sleepNow(this);
        } else if ("wake".equals(cmd)) {
            ScreenPower.wakeNow(this);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCommandIntent(intent);
    }

    private void buildWebView() {
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);               // localStorage: device_id persists -> stays paired
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // muted video ads autoplay
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        web.addJavascriptInterface(new KioskBridge(), "AndroidKiosk");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return false; // keep every navigation inside the kiosk WebView
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                lastAlive = SystemClock.elapsedRealtime();
                // Inject an independent heartbeat. If the page's JS context dies
                // or hangs, this interval dies with it and the watchdog fires.
                v.evaluateJavascript(
                    "(function(){if(window.__lmPing)return;" +
                    "window.__lmPing=setInterval(function(){try{AndroidKiosk.alive();}catch(e){}},15000);" +
                    "try{AndroidKiosk.alive();}catch(e){}})();", null);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) scheduleRetry();
            }

            // API < 23 fallback (older Fire OS).
            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView v, int code, String desc, String failingUrl) {
                scheduleRetry();
            }

            @Override
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                // The renderer process died (OOM/GPU). Rebuild the WebView instead
                // of letting Android kill the whole app. This is the fix for the
                // white-screen freeze that used to need a manual restart.
                recoverFromCrash();
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient());
        root.addView(web, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        lastAlive = SystemClock.elapsedRealtime();
        web.loadUrl(TV_URL);
    }

    private void recoverFromCrash() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        buildWebView();
    }

    private void scheduleRetry() {
        handler.postDelayed(new Runnable() {
            @Override public void run() {
                if (web != null) web.loadUrl(TV_URL);
            }
        }, 5_000L);
    }

    private final Runnable watchdog = new Runnable() {
        @Override public void run() {
            long since = SystemClock.elapsedRealtime() - lastAlive;
            if (since > WATCHDOG_TIMEOUT_MS && web != null) {
                web.stopLoading();
                web.loadUrl(TV_URL);
                lastAlive = SystemClock.elapsedRealtime();
            }
            handler.postDelayed(this, WATCHDOG_CHECK_MS);
        }
    };

    private final Runnable safetyReload = new Runnable() {
        @Override public void run() {
            if (web != null) web.loadUrl(TV_URL);
            handler.postDelayed(this, SAFETY_RELOAD_MS);
        }
    };

    /** The page's line to the shell. Every method here is called on a WebView
     *  thread, never the UI thread, so anything touching the window is posted. */
    private class KioskBridge {
        @JavascriptInterface
        public void alive() { lastAlive = SystemClock.elapsedRealtime(); }

        /** Who this screen is. The shell needs its own copy to ask the server
         *  "should I wake?" while the page is paused behind a dark panel. */
        @JavascriptInterface
        public void setDevice(String deviceId, String secret) {
            try { ScreenPower.setDevice(MainActivity.this, deviceId, secret); } catch (Exception ignored) {}
        }

        /** The venue's open hours, from the latest /api/tv/loop poll. */
        @JavascriptInterface
        public void setPowerSchedule(String json) {
            try { ScreenPower.setSchedule(MainActivity.this, json); } catch (Exception ignored) {}
        }

        /** Was this screen provisioned as device owner? Decides whether "off"
         *  powers the panel down or only paints it black, and the player says
         *  which one in its ack instead of calling both a success. */
        @JavascriptInterface
        public boolean deviceOwner() {
            try {
                return dpm != null
                        && dpm.isAdminActive(new ComponentName(MainActivity.this, KioskAdminReceiver.class));
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void screenOff() {
            handler.post(new Runnable() {
                @Override public void run() { ScreenPower.sleepNow(MainActivity.this); }
            });
        }

        @JavascriptInterface
        public void screenOn() {
            handler.post(new Runnable() {
                @Override public void run() { ScreenPower.wakeNow(MainActivity.this); }
            });
        }

        /** Restart the kiosk itself, for when the shell (not just the page) is
         *  wedged. recreate() rebuilds the activity, WebView and all. */
        @JavascriptInterface
        public void relaunch() {
            handler.post(new Runnable() {
                @Override public void run() {
                    try { recreate(); } catch (Exception e) {
                        if (web != null) web.loadUrl(TV_URL);
                    }
                }
            });
        }
    }

    // ---- Panel power --------------------------------------------------------

    /** Black the screen out where a true display-off isn't available (no device
     *  owner). Minimum backlight plus an opaque sheet: the room sees a dark TV,
     *  though the panel is still lit — which is why sleepNow() reports which of
     *  the two actually happened instead of calling both a success. */
    void setDark(final boolean dark) {
        handler.post(new Runnable() {
            @Override public void run() {
                try {
                    WindowManager.LayoutParams lp = getWindow().getAttributes();
                    lp.screenBrightness = dark ? 0.0f : -1.0f; // -1 = follow the system again
                    getWindow().setAttributes(lp);
                    if (dark) {
                        if (darkSheet == null) {
                            darkSheet = new View(MainActivity.this);
                            darkSheet.setBackgroundColor(0xFF000000);
                            root.addView(darkSheet, new FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT));
                        }
                        darkSheet.setVisibility(View.VISIBLE);
                        darkSheet.bringToFront();
                    } else if (darkSheet != null) {
                        darkSheet.setVisibility(View.GONE);
                    }
                } catch (Exception ignored) {}
            }
        });
    }

    /**
     * Stop holding the display on, or start again.
     *
     * Two things keep these panels lit around the clock and BOTH have to go, or
     * the screen turns off for an instant and the app lights it straight back
     * up: the screen-bright wake lock (released separately) and this window
     * flag. Missing the flag is exactly how "turn the screen off" looked like it
     * worked and didn't.
     */
    void allowDisplaySleep(final boolean allow) {
        handler.post(new Runnable() {
            @Override public void run() {
                try {
                    if (allow) {
                        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                } catch (Exception ignored) {}
            }
        });
    }

    /** Let the display sleep. The screen-bright lock is what keeps this panel up
     *  24/7, so it has to go before anything can turn the screen off. */
    void releaseScreenLock() {
        try {
            if (screenLock != null && screenLock.isHeld()) screenLock.release();
        } catch (Exception ignored) {}
    }

    void reacquireScreenLock() {
        try {
            if (screenLock != null && !screenLock.isHeld()) screenLock.acquire();
        } catch (Exception ignored) {}
    }

    /** Start the soft-kiosk watchdog that bounces the app back after a Home press.
     *  Harmless if it can't start; the app still runs as a normal player. */
    private void startWatchdog() {
        try {
            Intent svc = new Intent(this, KioskWatchdogService.class);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
        } catch (Exception ignored) {}
    }

    private void acquireLocks() {
        // Hoisted out of the first try: the screen-bright lock below needs it
        // too, and as a block-local it didn't compile — which is why the
        // "display must not sleep" fix has never actually reached a TV.
        final PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        try {
            cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "loopnetwork:cpu");
            cpuLock.setReferenceCounted(false);
            cpuLock.acquire();
        } catch (Exception ignored) {}
        try {
            // A PARTIAL lock keeps the CPU alive but explicitly lets the DISPLAY
            // sleep, which is exactly the failure we keep seeing: the TV is
            // powered, online, and the page is loaded, but nothing is painting.
            // The player treats no painted frames as offline (see app/tv, the
            // MIN_PAINT_FPS gate) and stops both the heartbeat and proof of
            // play, so a slept display and a dead stick look identical from the
            // dashboard. Deprecated since API 17 and ignored on some builds,
            // which is why it is additive and wrapped rather than a replacement.
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock bright = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                            | PowerManager.ACQUIRE_CAUSES_WAKEUP
                            | PowerManager.ON_AFTER_RELEASE,
                    "loopnetwork:screen");
            bright.setReferenceCounted(false);
            bright.acquire();
            screenLock = bright;
        } catch (Exception ignored) {}
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "loopnetwork:wifi");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        } catch (Exception ignored) {}
    }

    private void hideSystemBars() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = this;
        foreground = true;
        lastForegroundAt = SystemClock.elapsedRealtime();
        hideSystemBars();
        enterKioskIfLocked();
        if (web != null) web.onResume();
        // Coming back up means awake, so never resume behind a black sheet left
        // over from a sleep — a screen that woke and still looks off is the same
        // support call as one that never woke.
        if (!ScreenPower.isAsleep(this)) {
            setDark(false);
        } else {
            // We are up but the schedule says this screen should be asleep: a
            // host pressed a remote button at 3am, or something else woke the
            // panel. Give them a couple of minutes with it, then put it back the
            // way the schedule says — rather than fighting the remote instantly,
            // or leaving the TV lit until opening time tomorrow.
            handler.removeCallbacks(resettle);
            handler.postDelayed(resettle, RESETTLE_MS);
        }
    }

    /** Grace after an unscheduled wake before the schedule reasserts itself. */
    private static final long RESETTLE_MS = 2 * 60_000L;

    private final Runnable resettle = new Runnable() {
        @Override public void run() {
            try { ScreenPower.resettle(MainActivity.this); } catch (Exception ignored) {}
        }
    };

    @Override
    protected void onPause() {
        super.onPause();
        foreground = false;
        lastForegroundAt = SystemClock.elapsedRealtime();
        if (web != null) web.onPause();
    }

    // Swallow Back so the remote can't drop out of the kiosk.
    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        // else: stay in the app (deliberately do not call super)
    }

    // Hidden admin menu: MENU x3 within 2s.
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            long now = SystemClock.elapsedRealtime();
            if (now - firstMenuTapAt > 2_000L) { firstMenuTapAt = now; menuTaps = 0; }
            menuTaps++;
            if (menuTaps >= 3) { menuTaps = 0; showAdminDialog(); }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void showAdminDialog() {
        // The soft watchdog uses the same {@code unlocked} pref as the device-
        // owner lock, so "locked" is simply "not unlocked" in either mode.
        final boolean locked = !isUnlocked();
        final String lockLabel = locked
            ? "Unlock for setup (Wi-Fi, etc.)"
            : "Re-lock kiosk";
        final String[] options = {
            "Reload screen", lockLabel, "Open Wi-Fi / device settings", "Unpair this screen", "Exit app"
        };
        new AlertDialog.Builder(this)
            .setTitle("Loop Network — screen admin")
            .setItems(options, new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    switch (which) {
                        case 0: if (web != null) web.loadUrl(TV_URL); break;
                        case 1: toggleLock(); break;
                        case 2: openSettingsForMaintenance(); break;
                        case 3: unpair(); break;
                        default: exitApp(); break;
                    }
                }
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    // ---- Device-owner kiosk -------------------------------------------------

    /** Wire up lock-task + become the launcher, but only if this stick was made
     *  device owner. Everything here degrades to a no-op otherwise. */
    private void setupKiosk() {
        dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
        adminComponent = new ComponentName(this, KioskAdminReceiver.class);
        deviceOwner = dpm != null && dpm.isDeviceOwnerApp(getPackageName());
        if (!deviceOwner) return;
        // Whitelist ourselves so startLockTask() pins silently (no "screen
        // pinned" confirmation) and Home/Back/Recents can't leave.
        try { dpm.setLockTaskPackages(adminComponent, new String[]{ getPackageName() }); } catch (Exception ignored) {}
        // Device owner is exempt from Android's background-launch limits, so the
        // BootReceiver's relaunch actually works on modern Fire OS.
        setSelfAsHome(!isUnlocked());
    }

    /** Pin the app unless an admin has unlocked it for maintenance. */
    private void enterKioskIfLocked() {
        if (deviceOwner && !isUnlocked()) {
            try { startLockTask(); } catch (Exception ignored) {}
        }
    }

    /** Make (or stop making) this app the Fire TV home target, so the Home button
     *  and wake-from-sleep return here. Released during maintenance so the admin
     *  can reach Fire TV settings. */
    private void setSelfAsHome(boolean enable) {
        if (!deviceOwner) return;
        try {
            if (enable) {
                IntentFilter f = new IntentFilter(Intent.ACTION_MAIN);
                f.addCategory(Intent.CATEGORY_HOME);
                f.addCategory(Intent.CATEGORY_DEFAULT);
                dpm.addPersistentPreferredActivity(adminComponent, f,
                    new ComponentName(this, MainActivity.class));
            } else {
                dpm.clearPackagePersistentPreferredActivities(adminComponent, getPackageName());
            }
        } catch (Exception ignored) {}
    }

    private boolean isUnlocked() {
        return getSharedPreferences(KIOSK_PREFS, MODE_PRIVATE).getBoolean(KEY_UNLOCKED, false);
    }

    private void setUnlocked(boolean v) {
        getSharedPreferences(KIOSK_PREFS, MODE_PRIVATE).edit().putBoolean(KEY_UNLOCKED, v).apply();
    }

    /** Hidden-menu toggle between locked kiosk and unlocked maintenance mode.
     *  Works in both modes: the soft watchdog stands down whenever {@code
     *  unlocked} is true, and a device owner additionally releases lock-task. */
    private void toggleLock() {
        if (isUnlocked()) {
            // Re-lock: the watchdog re-arms immediately; device owner re-pins.
            setUnlocked(false);
            if (deviceOwner) {
                setSelfAsHome(true);
                try { startLockTask(); } catch (Exception ignored) {}
            }
            Toast.makeText(this, "Kiosk re-locked.", Toast.LENGTH_SHORT).show();
        } else {
            // Unlock for setup: the watchdog stops bouncing so you can leave the
            // app and reach Fire TV Settings (e.g. to join the host's Wi-Fi).
            setUnlocked(true);
            if (deviceOwner) {
                try { stopLockTask(); } catch (Exception ignored) {}
                setSelfAsHome(false);
            }
            Toast.makeText(this,
                "Unlocked. Press Home to reach Settings and join Wi-Fi. Re-lock from this menu (MENU x3) when done.",
                Toast.LENGTH_LONG).show();
        }
    }

    /** Drop the lock so we're allowed to leave, then jump straight to Wi-Fi.
     *  Always unlocks first (in either mode) so the soft watchdog does not yank
     *  us out of Settings before the host's Wi-Fi is joined. */
    private void openSettingsForMaintenance() {
        setUnlocked(true);
        if (deviceOwner) {
            try { stopLockTask(); } catch (Exception ignored) {}
            setSelfAsHome(false);
        }
        if (!launchAction(Settings.ACTION_WIFI_SETTINGS) && !launchAction(Settings.ACTION_SETTINGS)) {
            Toast.makeText(this, "Couldn't open settings automatically. Press Home, then open Settings.",
                Toast.LENGTH_LONG).show();
        }
    }

    private boolean launchAction(String action) {
        try {
            Intent i = new Intent(action);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void exitApp() {
        setUnlocked(true);   // stay out; onResume won't re-pin
        try { stopLockTask(); } catch (Exception ignored) {}
        setSelfAsHome(false);
        finish();
    }

    private void unpair() {
        if (web == null) return;
        // Clear the stored device id so the screen returns to the code-entry view.
        // The secret and every cached loop go too: the player recovers its identity
        // from a leftover `lm_loop_<id>` key (so a screen that unpairs itself after a
        // bad server reply can heal without a site visit), which means clearing only
        // `lm_device` would let this deliberate unpair silently undo itself on reload.
        web.evaluateJavascript(
            "try{localStorage.removeItem('lm_device');localStorage.removeItem('lm_device_secret');"
                + "var d=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);"
                + "if(k&&k.indexOf('lm_loop_')===0)d.push(k);}"
                + "for(var j=0;j<d.length;j++)localStorage.removeItem(d[j]);}catch(e){}",
            null);
        web.clearCache(true);
        web.loadUrl(TV_URL);
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        handler.removeCallbacksAndMessages(null);
        try { if (cpuLock != null && cpuLock.isHeld()) cpuLock.release(); } catch (Exception ignored) {}
        try { if (screenLock != null && screenLock.isHeld()) screenLock.release(); } catch (Exception ignored) {}
        try { if (wifiLock != null && wifiLock.isHeld()) wifiLock.release(); } catch (Exception ignored) {}
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
