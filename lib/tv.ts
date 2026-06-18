// Shared TV helpers.

import { randomInt, randomUUID } from 'node:crypto'

// Human-friendly pairing code, e.g. "LM-K7P2Q8" (no ambiguous 0/O/1/I). Used by
// the admin TV tools and host self-provisioning. Uses CSPRNG (randomInt), not
// Math.random, and 6 chars (~1B keyspace) so codes aren't brute-forceable; the
// pair endpoint also consumes a code on use so it's effectively single-shot.
export function genPairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[randomInt(chars.length)]
  return `LM-${s}`
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

// The setup URL a technician opens on a fresh Pi: it carries the pairing code so
// the screen pairs itself on first boot (or the tech can type the code into the
// player's pairing form). The code is consumed server-side on first use.
export function pairingUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, '')}/tv?code=${encodeURIComponent(code)}`
}

// Default loop config for a freshly provisioned screen (360s loop / 15s slots).
export const DEFAULT_LOOP_SECONDS = 360
export const DEFAULT_SLOT_SECONDS = 15
