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

    // Watchdog: the page pings us through the JS bridge. Hear nothing for this
    // long and the page has hung / white-screened, so reload it.
    private static final long WATCHDOG_TIMEOUT_MS = 90_000L;
    private static final long WATCHDOG_CHECK_MS = 30_000L;
    // Belt-and-suspenders hard reload so nothing drifts over days of uptime.
    private static final long SAFETY_RELOAD_MS = 6 * 60 * 60_000L;

    private FrameLayout root;
    private WebView web;
    private PowerManager.WakeLock cpuLock;
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
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setupKiosk();
        acquireLocks();
        startWatchdog();

        root = new FrameLayout(this);
        setContentView(root);
        buildWebView();

        handler.postDelayed(watchdog, WATCHDOG_CHECK_MS);
        handler.postDelayed(safetyReload, SAFETY_RELOAD_MS);
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

    /** Called from injected page JS every 15s while the loop is healthy. */
    private class KioskBridge {
        @JavascriptInterface
        public void alive() { lastAlive = SystemClock.elapsedRealtime(); }
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
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "loopnetwork:cpu");
            cpuLock.setReferenceCounted(false);
            cpuLock.acquire();
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
        foreground = true;
        lastForegroundAt = SystemClock.elapsedRealtime();
        hideSystemBars();
        enterKioskIfLocked();
        if (web != null) web.onResume();
    }

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
        final boolean locked = deviceOwner && !isUnlocked();
        final String lockLabel = locked
            ? "Unlock for maintenance (Wi-Fi, etc.)"
            : (deviceOwner ? "Re-lock kiosk" : "Kiosk lock not enabled on this stick");
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

    /** Hidden-menu toggle between locked kiosk and unlocked maintenance mode. */
    private void toggleLock() {
        if (!deviceOwner) {
            Toast.makeText(this,
                "This stick isn't a kiosk yet. Run the one-time adb set-device-owner step.",
                Toast.LENGTH_LONG).show();
            return;
        }
        if (isUnlocked()) {
            setUnlocked(false);
            setSelfAsHome(true);
            try { startLockTask(); } catch (Exception ignored) {}
            Toast.makeText(this, "Kiosk re-locked.", Toast.LENGTH_SHORT).show();
        } else {
            setUnlocked(true);
            try { stopLockTask(); } catch (Exception ignored) {}
            setSelfAsHome(false);
            Toast.makeText(this,
                "Unlocked. Press Home to reach Settings. Re-lock from this menu when done.",
                Toast.LENGTH_LONG).show();
        }
    }

    /** Drop the lock so we're allowed to leave, then jump straight to Wi-Fi. */
    private void openSettingsForMaintenance() {
        if (deviceOwner && !isUnlocked()) {
            setUnlocked(true);
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
        web.evaluateJavascript("try{localStorage.removeItem('lm_device');}catch(e){}", null);
        web.clearCache(true);
        web.loadUrl(TV_URL);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        try { if (cpuLock != null && cpuLock.isHeld()) cpuLock.release(); } catch (Exception ignored) {}
        try { if (wifiLock != null && wifiLock.isHeld()) wifiLock.release(); } catch (Exception ignored) {}
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
