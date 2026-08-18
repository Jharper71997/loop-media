package org.loopnetwork.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.Uri;
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
    // Native copy of this screen's identity. The web player keeps the same
    // values in localStorage, but localStorage is exactly what gets wiped when
    // the player mistakenly believes it was unpaired -- and then the screen sits
    // on a pairing code until a human drives out to it. These two keys are the
    // copy that survives that, and they are fed back in through the URL.
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_DEVICE_SECRET = "device_secret";

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
                    "(function(){" +
                    "function cap(){try{var d=localStorage.getItem('lm_device');" +
                    "if(d)AndroidKiosk.identity(d,localStorage.getItem('lm_device_secret'));}catch(e){}}" +
                    "cap();" +
                    "if(window.__lmPing)return;" +
                    "window.__lmPing=setInterval(function(){try{AndroidKiosk.alive();}catch(e){}cap();},15000);" +
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
        web.loadUrl(kioskUrl());
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
                if (web != null) web.loadUrl(kioskUrl());
            }
        }, 5_000L);
    }

    private final Runnable watchdog = new Runnable() {
        @Override public void run() {
            long since = SystemClock.elapsedRealtime() - lastAlive;
            if (since > WATCHDOG_TIMEOUT_MS && web != null) {
                web.stopLoading();
                web.loadUrl(kioskUrl());
                lastAlive = SystemClock.elapsedRealtime();
            }
            handler.postDelayed(this, WATCHDOG_CHECK_MS);
        }
    };

    private final Runnable safetyReload = new Runnable() {
        @Override public void run() {
            if (web != null) web.loadUrl(kioskUrl());
            handler.postDelayed(this, SAFETY_RELOAD_MS);
        }
    };

    /** Called from injected page JS every 15s while the loop is healthy. */
    private class KioskBridge {
        @JavascriptInterface
        public void alive() { lastAlive = SystemClock.elapsedRealtime(); }

        /** Page hands us its identity so we can hand it back after any wipe. */
        @JavascriptInterface
        public void identity(String id, String secret) { rememberIdentity(id, secret); }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(KIOSK_PREFS, MODE_PRIVATE);
    }

    /** The kiosk URL carrying this screen's identity once we have seen it.
     *  The player prefers ?device= / &secret= over localStorage, so a screen that
     *  clears its own storage still comes back as the SAME screen instead of
     *  dropping to a pairing code and needing a site visit. */
    private String kioskUrl() {
        String id = prefs().getString(KEY_DEVICE_ID, null);
        if (id == null || id.isEmpty()) return TV_URL;
        String url = TV_URL + "?device=" + Uri.encode(id);
        String secret = prefs().getString(KEY_DEVICE_SECRET, null);
        if (secret != null && !secret.isEmpty()) url += "&secret=" + Uri.encode(secret);
        return url;
    }

    private void rememberIdentity(String id, String secret) {
        if (id == null || id.trim().isEmpty()) return;
        SharedPreferences.Editor e = prefs().edit().putString(KEY_DEVICE_ID, id.trim());
        if (secret != null && !secret.trim().isEmpty()) {
            e.putString(KEY_DEVICE_SECRET, secret.trim());
        }
        e.apply();
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
        // The soft watchdog uses the same {@code unlocked} pref as the device-
        // owner lock, so "locked" is simply "not unlocked" in either mode.
        final boolean locked = !isUnlocked();
        // On Fire OS 8+ the bounce-back is blocked until the app is granted
        // SYSTEM_ALERT_WINDOW once. Say so here rather than letting an installer
        // walk away from a screen that looks fine and escapes on the first Home.
        final boolean armed = KioskWatchdogService.canPullForward(this);
        final java.util.ArrayList<String> items = new java.util.ArrayList<String>();
        items.add("Reload screen");
        items.add(locked ? "Unlock for setup (Wi-Fi, etc.)" : "Re-lock kiosk");
        items.add("Open Wi-Fi / device settings");
        if (!armed) items.add("Fix kiosk permission (Home button escapes)");
        items.add("Unpair this screen");
        items.add("Exit app");
        final String[] options = items.toArray(new String[0]);
        new AlertDialog.Builder(this)
            .setTitle(armed ? "Loop Network \u2014 screen admin"
                            : "Loop Network \u2014 kiosk NOT armed")
            .setItems(options, new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    String choice = options[which];
                    if (choice.startsWith("Reload")) {
                        if (web != null) web.loadUrl(kioskUrl());
                    } else if (choice.startsWith("Unlock") || choice.startsWith("Re-lock")) {
                        toggleLock();
                    } else if (choice.startsWith("Open Wi-Fi")) {
                        openSettingsForMaintenance();
                    } else if (choice.startsWith("Fix kiosk")) {
                        showKioskPermissionHelp();
                    } else if (choice.startsWith("Unpair")) {
                        unpair();
                    } else {
                        exitApp();
                    }
                }
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    /** Android 10+ (Fire OS 8 and up) blocks background activity starts, which is
     *  how the watchdog pulls the loop back after a Home press. Some builds expose
     *  an overlay-permission screen that grants it from the remote; stock Fire OS
     *  does not, so fall back to showing the one-time ADB command. */
    private void showKioskPermissionHelp() {
        setUnlocked(true); // don't let the watchdog yank us out of Settings
        if (android.os.Build.VERSION.SDK_INT >= 23) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                Toast.makeText(this,
                    "Allow \"display over other apps\", then re-lock from MENU x3.",
                    Toast.LENGTH_LONG).show();
                return;
            } catch (Exception ignored) {}
        }
        // No overlay screen on this build, so we are staying put: re-arm the
        // watchdog rather than leaving the screen unlocked behind the dialog.
        setUnlocked(false);
        new AlertDialog.Builder(this)
            .setTitle("One-time setup command")
            .setMessage("This TV blocks the kiosk bounce-back until it is granted once "
                + "from a laptop:\n\n"
                + "adb connect <this TV's IP>:5555\n"
                + "adb shell appops set org.loopnetwork.kiosk SYSTEM_ALERT_WINDOW allow\n\n"
                + "It survives reboots and is only needed once per TV. "
                + "The IP is in Settings > My Fire TV > About > Network.")
            .setPositiveButton("OK", null)
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
        // Drop the native copy too, or the very next load would hand the id
        // straight back and the unpair would appear to do nothing.
        prefs().edit().remove(KEY_DEVICE_ID).remove(KEY_DEVICE_SECRET).apply();
        web.clearCache(true);
        // ?reset=1 is the player's own "forget yourself" lever: it clears storage
        // and purges the cached loops the player would otherwise recover its id
        // from. Belt and braces with the JS above, and it works even if the
        // evaluateJavascript call above lost its race with the page.
        web.loadUrl(TV_URL + "?reset=1");
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
