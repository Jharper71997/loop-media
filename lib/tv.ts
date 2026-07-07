// Shared TV helpers.

import { randomInt, randomUUID } from 'node:crypto'

// Human-friendly code, e.g. "K7P2" (no ambiguous 0/O/1/I). Uses CSPRNG
// (randomInt), not Math.random. `len` chars from a 32-char alphabet. Used for both
// TV pairing codes and trivia join codes — pass the length for the context.
export function genPairingCode(len = 4): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[randomInt(chars.length)]
  return s
}

// TV pairing codes GRANT CONTROL of a screen (a valid code binds a device), so
// they use a longer 8-char code (~1.1e12 space) that — with the /api/tv/pair rate
// limit — can't be brute-forced. Trivia join codes stay short (default 4) since
// they only let a phone join a game and must be typed by a customer. This is the
// screen's permanent key: the pair endpoint keeps it, so a host can re-view it on
// their dashboard and re-add a device anytime (see app/api/tv/pair).
export const TV_PAIRING_CODE_LEN = 8

// Per-device secret check (migration 0036). Devices paired before secrets existed
// have a NULL stored secret and are grandfathered through (so a live screen never
// breaks on deploy); they gain one when they next re-pair. A device that HAS a
// secret must present the matching value via the x-device-secret header (or
// ?secret= on a provisioned kiosk URL).
export function deviceSecretOk(
  storedSecret: string | null | undefined,
  req: Request
): boolean {
  if (!storedSecret) return true // legacy / unprovisioned device — grandfathered
  const provided =
    req.headers.get('x-device-secret') ||
    new URL(req.url).searchParams.get('secret')
  return !!provided && provided === storedSecret
}

// Opaque device identity baked into a provisioned screen's kiosk URL
// (/tv?device=<id>). We program the Pi before shipping it, so the screen runs
// as this device from first boot with no pairing step — it just heartbeats and
// goes live. A random UUID is unguessable and collision-free, so no retry loop.
export function genDeviceId(): string {
  return randomUUID()
}

// The kiosk URL for an already-paired screen, keyed on its device id. Use this
// to re-image a replacement Pi for the SAME screen without re-pairing.
export function kioskUrl(origin: string, deviceId: string): string {
  return `${origin.replace(/\/$/, '')}/tv?device=${encodeURIComponent(deviceId)}`
}

// The setup URL a technician opens on a fresh screen: it carries the pairing code
// so the screen pairs itself on first boot (or the tech/host can type the code
// into the player's pairing form). The code is reusable — pairing keeps it, so
// the same link/code can re-add the screen later.
export function pairingUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, '')}/tv?code=${encodeURIComponent(code)}`
}

// Default loop config for a freshly provisioned screen (360s loop / 15s slots).
export const DEFAULT_LOOP_SECONDS = 360
export const DEFAULT_SLOT_SECONDS = 15
