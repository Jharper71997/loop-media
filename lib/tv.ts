// Shared TV helpers.

import { randomInt, randomUUID } from 'node:crypto'

// Human-friendly pairing code, e.g. "K7P2" (no ambiguous 0/O/1/I). Used by the
// admin TV tools, host self-provisioning, and the /tv pairing form. Uses CSPRNG
// (randomInt), not Math.random. 4 chars from a 32-char alphabet (~1M codes) —
// short enough to read off a TV and type on a remote. This is the screen's
// PERMANENT key: the pair endpoint no longer consumes it, so a host can re-view
// it on their dashboard and re-add a device anytime (see app/api/tv/pair).
export function genPairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 4; i++) s += chars[randomInt(chars.length)]
  return s
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
