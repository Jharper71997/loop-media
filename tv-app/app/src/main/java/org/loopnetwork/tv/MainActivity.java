package org.loopnetwork.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
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

    private static final String TV_URL = "https://loopnetwork.org/tv";

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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Never dim or sleep while the app is foreground. (The TV's own
        // screensaver/auto-power-off must still be disabled in its settings —
        // no app can override that from inside.)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        acquireLocks();

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
        hideSystemBars();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
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
        final String[] options = { "Reload screen", "Unpair this screen", "Exit app" };
        new AlertDialog.Builder(this)
            .setTitle("Loop Network — screen admin")
            .setItems(options, new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface dialog, int which) {
                    if (which == 0) {
                        if (web != null) web.loadUrl(TV_URL);
                    } else if (which == 1) {
                        unpair();
                    } else {
                        finish();
                    }
                }
            })
            .setNegativeButton("Cancel", null)
            .show();
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
