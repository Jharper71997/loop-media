// Shared TV helpers.

import { randomInt } from 'node:crypto'

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

// Default loop config for a freshly provisioned screen (360s loop / 15s slots).
export const DEFAULT_LOOP_SECONDS = 360
export const DEFAULT_SLOT_SECONDS = 15
