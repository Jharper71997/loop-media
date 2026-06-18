'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import { genPairingCode } from '@/lib/tv'

// pairing_code is UNIQUE, so a fresh code can (rarely) collide. Insert/update
// with a few retries on the unique violation (Postgres 23505) before giving up.
function isCodeCollision(err: { code?: string; message?: string } | null): boolean {
  return err?.code === '23505' || (err?.message ?? '').toLowerCase().includes('pairing_code')
}

export async function createTv(input: {
  venue_id: string
  loop_length_seconds: number
  slot_seconds: number
}) {
  await requireAdmin()
  const supabase = await createClient()

  // A technician sets up the Pi on-site and pairs the screen with this code
  // (typed into the player, or via the /tv?code=… setup link). Pairing mints the
  // device_id server-side and consumes the code. The screen is "unpaired" until
  // then, then flips to live on its first heartbeat.
  let lastError: { message: string } | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase.from('tvs').insert({
      venue_id: input.venue_id,
      pairing_code: genPairingCode(),
      status: 'unpaired',
      loop_length_seconds: input.loop_length_seconds,
      slot_seconds: input.slot_seconds,
    })
    if (!error) {
      revalidatePath('/admin/tvs')
      return { error: null }
    }
    lastError = error
    if (!isCodeCollision(error)) break
  }
  return { error: lastError?.message ?? 'Could not create the screen.' }
}

// Regenerate a screen's pairing code: issue a fresh code, drop any current
// device binding (so the old Pi stops counting), and clear its history. Use this
// to re-pair a screen — the technician pairs the Pi again with the new code.
export async function regeneratePairingCode(id: string) {
  await requireAdmin()
  const supabase = await createClient()
  let lastError: { message: string } | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase
      .from('tvs')
      .update({
        pairing_code: genPairingCode(),
        device_id: null,
        status: 'unpaired',
        last_heartbeat_at: null,
        last_sync_at: null,
      })
      .eq('id', id)
    if (!error) {
      revalidatePath('/admin/tvs')
      return { error: null }
    }
    lastError = error
    if (!isCodeCollision(error)) break
  }
  return { error: lastError?.message ?? 'Could not regenerate the pairing code.' }
}

export async function deleteTv(id: string) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('tvs').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/tvs')
  return { error: null }
}
