'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, adminCanTerritory } from '@/lib/auth'
import type { Profile } from '@/lib/db.types'
import { genPairingCode } from '@/lib/tv'

type Supa = Awaited<ReturnType<typeof createClient>>

// The territory a screen belongs to (via its venue). tvs RLS is plain is_admin()
// with no territory scope (see 0002_rls.sql "tighten later"), so admin actions
// that mutate a screen must check the territory here. Returns undefined if the
// screen is missing, null if its venue has no territory.
async function tvTerritoryId(supabase: Supa, tvId: string): Promise<string | null | undefined> {
  const { data: tv } = await supabase.from('tvs').select('venue_id').eq('id', tvId).maybeSingle()
  if (!tv?.venue_id) return undefined
  const { data: v } = await supabase
    .from('venues')
    .select('territory_id')
    .eq('id', tv.venue_id)
    .maybeSingle()
  return v?.territory_id ?? null
}

async function guardTv(
  supabase: Supa,
  profile: Profile,
  tvId: string
): Promise<string | null> {
  const terr = await tvTerritoryId(supabase, tvId)
  if (terr === undefined) return 'Screen not found.'
  if (!adminCanTerritory(profile, terr)) return 'Not allowed for your territory.'
  return null
}

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
  const profile = await requireAdmin()
  const supabase = await createClient()

  // Confine to the caller's territory (tvs RLS doesn't scope by territory).
  const { data: venue } = await supabase
    .from('venues')
    .select('territory_id')
    .eq('id', input.venue_id)
    .maybeSingle()
  if (!venue) return { error: 'Venue not found.' }
  if (!adminCanTerritory(profile, venue.territory_id))
    return { error: 'Not allowed for your territory.' }

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
  const profile = await requireAdmin()
  const supabase = await createClient()
  const denied = await guardTv(supabase, profile, id)
  if (denied) return { error: denied }
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
  const profile = await requireAdmin()
  const supabase = await createClient()
  const denied = await guardTv(supabase, profile, id)
  if (denied) return { error: denied }
  const { error } = await supabase.from('tvs').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/tvs')
  return { error: null }
}
