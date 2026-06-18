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

// The kiosk URL we bake into a provisioned Pi for a given device.
export function kioskUrl(origin: string, deviceId: string): string {
  return `${origin.replace(/\/$/, '')}/tv?device=${encodeURIComponent(deviceId)}`
}

// Default loop config for a freshly provisioned screen (360s loop / 15s slots).
export const DEFAULT_LOOP_SECONDS = 360
export const DEFAULT_SLOT_SECONDS = 15
