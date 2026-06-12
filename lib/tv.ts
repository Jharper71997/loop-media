// Shared TV helpers.

// Human-friendly pairing code, e.g. "LM-K7P2Q" (no ambiguous 0/O/1/I). Used by
// the admin TV tools and host self-provisioning.
export function genPairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `LM-${s}`
}

// Default loop config for a freshly provisioned screen (360s loop / 15s slots).
export const DEFAULT_LOOP_SECONDS = 360
export const DEFAULT_SLOT_SECONDS = 15
