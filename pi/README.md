# Loop Network — Raspberry Pi TV kiosk runbook

Turn any Raspberry Pi into a Loop Network venue screen that boots straight into
the `/tv` ad player, full-screen, no mouse, no desktop.

There are two files here:

| File | Runs where | Does |
|---|---|---|
| `setup-loop-pi.ps1` | **Your Windows PC** | One command: provisions a booted Pi over SSH. |
| `provision-kiosk.sh` | **On the Pi** | The actual kiosk config. Called by the PS script; can also be run by hand. |

---

## One-time setup (do this once, ever)

### A. Save your Imager settings
Open **Raspberry Pi Imager** → Choose OS → **Edit Settings**, fill in:

- **General:** hostname `loop-tv-01`, user `loop` / your password, WiFi SSID + password, country `US`, timezone `America/Chicago`, keyboard `us`
- **Services:** Enable SSH → **public-key only** → paste the contents of
  `C:\Users\jacob\.ssh\id_ed25519.pub`

Imager **remembers these**. From now on every flash auto-fills them — you only
click Choose Device / OS / Storage → Write.

> Hostname stays `loop-tv-01` on every card; that's fine — `setup-loop-pi.ps1`
> finds the Pi at `loop-tv-01.local`. Only flash one new Pi at a time.

---

## Per new Pi (every venue)

1. **Flash** the SD card in Imager (settings remembered → 3 clicks → Write).
   Cancel any Windows "format this disk?" pop-ups.
2. **Boot** the Pi (card in, HDMI to TV, power). Wait ~1 minute for WiFi.
3. **One command** on your PC, from this folder:

   ```powershell
   .\setup-loop-pi.ps1 LM-563BMA
   ```

   (swap in that venue's pairing code). Type the Pi password once when asked.

The Pi reboots and the TV shows the player. That's it.

### Options
```powershell
.\setup-loop-pi.ps1 LM-XXXXX -PiHost 10.0.0.44      # if .local doesn't resolve, use the IP
.\setup-loop-pi.ps1 LM-XXXXX -Base https://loopnetwork.tv   # once off the temp domain
```

---

## What `provision-kiosk.sh` actually sets up

- **GPU mode by Pi model.** Pi 3B+/older have an OpenGL ES 2.0 GPU, but Chromium
  on Pi OS forces ES 3.0 → the GPU process crash-loops and the TV shows a blank
  desktop. Fix = software render (`--use-angle=swiftshader`). Pi 4/5 keep
  hardware GL. The script auto-detects which.
- **Invisible mouse cursor** (transparent Xcursor theme).
- **Kiosk launcher** in `~/.config/labwc/autostart`: HDMI-only, self-healing
  (relaunches Chromium if it ever exits), waits for HDMI on cold boot.
- **Screen blanking off** so the TV never sleeps.

Re-running it is safe (idempotent); it backs up the old autostart.

---

## Pairing

A freshly-wiped Pi lands on the manual pairing screen the first time, because
auto-pair (`?code=` in the kiosk URL self-pairs the device) is **built but not
yet deployed**. Until that ships, pair once from the venue (or remotely) after
first boot. Once auto-pair is live, the `?code=LM-XXXXX` the script bakes into
the URL pairs the screen with zero touch.

---

## The real fleet endgame (when scaling past a handful)

For 250 screens, the repeatable-but-still-manual flow above gets replaced by
**balenaOS**: flash ONE identical image to every card, set each venue's pairing
code as a per-device cloud env var, and the balena dashboard gives you
online/offline monitoring, remote reboot, and over-the-air updates. Ask Claude
to set up the balena fleet when you're ready — that's the true plug-and-ship.
