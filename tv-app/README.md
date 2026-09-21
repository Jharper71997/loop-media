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

- **Signing:** the build uses a stable release key when CI has one, and falls
  back to the debug key when it doesn't (so a local or forked build needs no
  secrets). This stopped being cosmetic the moment screens became remotely
  updatable: the runner mints a FRESH debug keystore every run, Android refuses
  `adb install -r` across a key change, and updating a wall-mounted TV then means
  uninstalling — which wipes its pairing. To set the key up once:

  ```bash
  keytool -genkeypair -v -keystore loop-release.jks -alias loop     -keyalg RSA -keysize 2048 -validity 10000
  base64 -w0 loop-release.jks     # paste into the LOOP_KEYSTORE_BASE64 secret
  ```

  Repo secrets: `LOOP_KEYSTORE_BASE64`, `LOOP_KEYSTORE_PASSWORD`,
  `LOOP_KEY_ALIAS`, `LOOP_KEY_PASSWORD`. Keep the `.jks` somewhere safe and
  off the repo — lose it and every screen needs an uninstall/reinstall again.
  The switch to it is itself one uninstall/reinstall per screen; after that,
  updates install over the top.
- **Domain:** the URL is hardcoded to `https://loopnetwork.org/tv`. That domain
  must be serving the app before shipping the APK, or every screen shows nothing.
- **Branding:** launcher icon = `apple-touch-icon.png`, TV banner =
  `loop-network-logo.png`, copied into `app/src/main/res/drawable/`. Swap those
  files to rebrand.
- **package:** `org.loopnetwork.tv` (distinct from the phone/host app
  `org.loopnetwork.app`).

## Panel power (v1.8)

A screen can now be turned off and on remotely, and can keep the venue's hours by
itself. The mechanism matters, because a venue's router NATs the TV and nothing
can dial in to it:

- The player polls `/api/tv/loop` every ~30s. That response now carries any
  commands an admin queued (`sleep`, `wake`, `reload`, `relaunch`) and the
  venue's open hours. The player hands the hours to the shell over the JS bridge
  (`AndroidKiosk.setPowerSchedule`) and acks each command to `/api/tv/command`,
  so the admin page can show queued / delivered / done rather than just "sent".
- `ScreenPower` arms an exact alarm for the next open or close. Alarms, not a
  timer in the page: the page is paused while the panel is dark, and alarms
  survive Doze and are re-armed on boot.
- **While the panel is off the player is not running**, so the shell asks
  `/api/tv/wake?device=…` once a minute (`PowerAlarmReceiver`). That is the only
  inbound path a dark screen has, and it is what makes "turn it on" work on a
  screen that is currently off.
- **Turning off properly needs device owner.** `lockNow()` (declared via
  `<force-lock/>` in `res/xml/device_admin.xml`) is a real display-off. Without
  device owner the app blacks the screen at minimum backlight instead — the room
  sees a dark TV, the panel is still lit — and the ack says so rather than
  reporting a half-measure as success.
