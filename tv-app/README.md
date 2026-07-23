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

## How a host installs it (no computer needed)

1. On the Fire TV: Settings → My Fire TV → Developer options → **Install unknown
   apps** → enable for the **Downloader** app (one-time).
2. Install **Downloader** (by AFTVnews) from the Fire TV app store if not present.
3. Open Downloader, enter **`www.loopnetwork.org/app`**, download, Install, Open.
   Type the `www.` — the bare apex 308s twice (http→https, then apex→www) and
   Downloader hangs on "Connecting…" instead of following it.
4. Enter the 4-character **pairing code** from the Loop Network dashboard. Done —
   it stays paired across reboots.

> One-time setup ends at step 3. Everything after is just the code. To remove
> even the sideload step later, publish to the **Amazon Appstore** so hosts
> search "Loop Network" and one-tap install.

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
