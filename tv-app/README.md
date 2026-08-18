# Loop Network TV — kiosk app

A branded Android APK that turns a **Fire TV Stick / Fire TV / Android TV** into
a Loop Network signage screen. It is a thin native shell around
`https://loopnetwork.org/tv`; all signage logic (playlist, pairing, heartbeat,
offline cache, self-update) lives in the web app and updates over the air, so
this shell almost never needs to change.

## What it does (Fully-Kiosk-grade behavior)

- Opens `loopnetwork.org/tv` fullscreen, no browser chrome, no Android UI
- **Keeps the screen awake** — keep-screen-on flag + CPU + WiFi wake locks
- **Auto-launches on boot** (`BootReceiver`)
- **Renderer-crash recovery** (`onRenderProcessGone`) — rebuilds the WebView
  instead of leaving a dark/white screen that needs a manual restart
- **JS watchdog** — injected heartbeat; if the page hangs for 90s it reloads
- **Network-drop retry** + a 6-hour safety reload
- **Back button can't exit**; a hidden **MENU x3** gesture opens an admin dialog
  (Reload / Unpair / Exit)

### Not included (doesn't apply to a Fire Stick)
Motion-detection wake (needs a camera), mouse-cursor hiding (no mouse),
brightness control. The **Home** button can't be fully blocked on Fire OS
unless the app is set as the launcher — an OS limit, not a code gap.

## Which TV can run this (the Insignia question)

One APK, every Fire TV. `minSdk 22` covers Fire OS 5 through 8, and the
special-use foreground-service type keeps it alive on the API-34 Fire OS 14
generation. There is no per-model build.

Check **Settings > My Fire TV > About > Software version** before anything else:

| Version starts with | What it is | Works? |
| --- | --- | --- |
| 5, 6, 7 | Fire OS 5-7 (Android 5-9) | Yes, nothing extra |
| 8 or 14 | Fire OS 8+ (Android 10+) | Yes, plus the one-time appops grant below |
| `1.` | **Vega OS** (Fire TV Stick 4K Select, Stick HD 2nd gen) | **No. Not Android, no sideloading, by any method.** |

Insignia F20 / F30 / F50 are all Fire TV built-ins and all still ship Fire OS, so
any current Insignia works. What does **not** work is an Insignia **Roku** TV or a
pre-Fire-TV Insignia: neither runs Android, and Roku killed non-certified private
channels (beta channels cap at 20 devices and expire), so there is no port worth
building. Treat those panels as dumb screens and drive them with a **Fire TV Stick
4K Max** on HDMI 1, which is the same install below and makes literally any TV a
Loop screen.

## Installing on a TV (no computer needed)

1. Settings > My Fire TV > **About** > highlight the TV name > press Select **7x**
   to reveal Developer options.
2. Developer options > **Install unknown apps** > enable for **Downloader**
   (newer Fire OS made this per-app; there is no global unknown-sources switch).
3. Install **Downloader** (by AFTVnews) from the Fire TV app store.
4. Open Downloader, enter **`www.loopnetwork.org/app`**, download, Install, Open.
   Type the `www.` — the bare apex 308s twice (http->https, then apex->www) and
   Downloader hangs on "Connecting…" instead of following it.
5. **Open the app once by hand.** An app that has never been launched, or that was
   ever force-stopped, receives no `BOOT_COMPLETED` at all, permanently.
6. Enter the 4-character **pairing code** from the Loop Network dashboard.

Reinstalling over an existing copy fails the signature check (each CI build signs
with a fresh debug key), so **uninstall the old app first**.

### Fire OS 8+ only: one command per TV

Android 10 added background-activity-launch restrictions, and a foreground service
gets no exemption, so the soft watchdog cannot pull the loop back after a Home
press until the app holds `SYSTEM_ALERT_WINDOW`. There is no Fire OS UI for it:

```bash
adb connect <tv-ip>:5555          # IP is in About > Network
adb shell appops set org.loopnetwork.kiosk SYSTEM_ALERT_WINDOW allow
```

It persists across reboots and is needed once per TV. The app cannot do this to
itself — Amazon blocked local ADB in Fire OS 7.6.6.9 / 8.1.0.3. The hidden admin
menu (**MENU x3**) reads "kiosk NOT armed" and offers **Fix kiosk permission**
whenever the grant is missing, so nobody leaves a screen that looks fine and
escapes on the first Home press.

### TV settings, every unit

- **Parental Controls OFF.** A PIN protecting app launches redirects every launch
  into the PIN wizard, our code never runs, and the kiosk silently dies.
- Screensaver **Never**; disable Sleep / auto power off. No app can override these.
- Power Controls > Power On > **Last Input**.
- Fire OS 8 kicks to home after 4h idle ("Are you still watching?"). Amazon
  exempts signage apps through a Developer Support case.

### Verify before it leaves the bench

Home button bounces back in 1-2s; unplug 30s and it returns to `/tv` on its own;
the venue shows live in admin.

## Build

Built in the cloud by `.github/workflows/tv-app.yml` — no local Android SDK
needed. Push to `main` (touching `tv-app/**`) or run the **Build TV APK**
workflow manually. It publishes `loop-network-tv.apk` to the `tv-app-latest`
release, which `www.loopnetwork.org/app` streams to the TV.

Local build (if you have the Android SDK + JDK 17):

```bash
cd tv-app
gradle assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

## Notes / upgrade path

- **Signing:** v1 uses the debug key (installs via sideload, zero secrets). The
  web app self-updates, so the shell rarely changes. If you ever ship a new
  shell version and want in-place updates, add a release keystore as GitHub
  secrets and switch `signingConfig` in `app/build.gradle`. (Different signing
  key = uninstall/reinstall on devices.)
- **Domain:** the URL is hardcoded to `https://loopnetwork.org/tv`. That domain
  must be serving the app before shipping the APK, or every screen shows nothing.
- **Branding:** launcher icon = `apple-touch-icon.png`, TV banner =
  `loop-network-logo.png`, copied into `app/src/main/res/drawable/`. Swap those
  files to rebrand.
- **package:** `org.loopnetwork.tv` (distinct from the phone/host app
  `org.loopnetwork.app`).
