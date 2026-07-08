'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, adminCanTerritory } from '@/lib/auth'
import type { Profile } from '@/lib/db.types'

type Supa = Awaited<ReturnType<typeof createClient>>

function maxSlots(loop: number, slot: number): number {
  return Math.max(1, Math.floor((loop || 360) / (slot || 15)))
}

// tvs/placements RLS is plain is_admin() (no territory scope), so screen-level
// admin actions check the screen's territory (via its venue) here.
async function guardTv(supabase: Supa, profile: Profile, tvId: string): Promise<string | null> {
  const { data: tv } = await supabase.from('tvs').select('venue_id').eq('id', tvId).maybeSingle()
  if (!tv?.venue_id) return 'Screen not found.'
  const { data: v } = await supabase
    .from('venues')
    .select('territory_id')
    .eq('id', tv.venue_id)
    .maybeSingle()
  if (!adminCanTerritory(profile, v?.territory_id ?? null)) return 'Not allowed for your territory.'
  return null
}

export async function updateTvLoop(
  id: string,
  input: { loop_length_seconds: number; slot_seconds: number }
) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const denied = await guardTv(supabase, profile, id)
  if (denied) return { error: denied }
  const { error } = await supabase
    .from('tvs')
    .update({
      loop_length_seconds: input.loop_length_seconds,
      slot_seconds: input.slot_seconds,
    })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tvs/${id}`)
  return { error: null as string | null }
}

// How long a slide may hold on screen. The DB requires > 0; keep a sane signage
// range so a typo can't set 0 (schema reject) or an absurd value.
const MIN_AD_SECONDS = 3
const MAX_AD_SECONDS = 600

function validSeconds(seconds: number): number | null {
  const secs = Math.round(seconds)
  if (!Number.isFinite(secs) || secs < MIN_AD_SECONDS || secs > MAX_AD_SECONDS) return null
  return secs
}

// Set how long ONE ad holds on screen (ads.duration_seconds). The TV player reads
// this per slide (see /api/tv/loop line: `ad.duration_seconds || slot_seconds`),
// so the change shows on the screen within ~30s on its next sync. Video ads run to
// their own end and ignore this. Territory-guarded via the screen.
export async function updateAdDuration(tvId: string, adId: string, seconds: number) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const denied = await guardTv(supabase, profile, tvId)
  if (denied) return { error: denied }
  const secs = validSeconds(seconds)
  if (secs === null)
    return { error: `Enter a whole number of seconds between ${MIN_AD_SECONDS} and ${MAX_AD_SECONDS}.` }
  const { error } = await supabase.from('ads').update({ duration_seconds: secs }).eq('id', adId)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tvs/${tvId}`)
  return { error: null as string | null }
}

// "Apply to all": push the same on-screen time to every ad currently placed on
// this screen, in one click. Only touches ads active on THIS screen.
export async function setAllAdDurations(tvId: string, seconds: number) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const denied = await guardTv(supabase, profile, tvId)
  if (denied) return { error: denied }
  const secs = validSeconds(seconds)
  if (secs === null)
    return { error: `Enter a whole number of seconds between ${MIN_AD_SECONDS} and ${MAX_AD_SECONDS}.` }
  const { data: pls } = await supabase
    .from('ad_placements')
    .select('ad_id')
    .eq('tv_id', tvId)
    .eq('status', 'active')
  const adIds = [...new Set((pls ?? []).map((p) => p.ad_id).filter((x): x is string => !!x))]
  if (!adIds.length) return { error: 'No ads on this screen yet.' }
  const { error } = await supabase.from('ads').update({ duration_seconds: secs }).in('id', adIds)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tvs/${tvId}`)
  return { error: null as string | null }
}

// Pull an ad off this screen (kept in history as ended; frees its slot). Also
// record an exclusion so the placement engine won't just re-add it on its next
// run (the override has to stick). See migration 0013.
export async function removePlacement(placementId: string, tvId: string) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const denied = await guardTv(supabase, profile, tvId)
  if (denied) return { error: denied }

  // Grab the campaign before ending so we can exclude this campaign↔tv pair.
  const { data: pl } = await supabase
    .from('ad_placements')
    .select('campaign_id')
    .eq('id', placementId)
    .maybeSingle()

  const { error } = await supabase
    .from('ad_placements')
    .update({ status: 'ended', end_date: new Date().toISOString().slice(0, 10) })
    .eq('id', placementId)
  if (error) return { error: error.message }

  if (pl?.campaign_id) {
    await supabase
      .from('placement_exclusions')
      .upsert(
        { campaign_id: pl.campaign_id, tv_id: tvId },
        { onConflict: 'campaign_id,tv_id', ignoreDuplicates: true }
      )
  }
  revalidatePath(`/admin/tvs/${tvId}`)
  return { error: null as string | null }
}

// Manually drop an approved ad into the first free slot on this screen.
export async function addPlacement(tvId: string, adId: string) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const denied = await guardTv(supabase, profile, tvId)
  if (denied) return { error: denied }

  // Only an approved (or already-live) ad may be dropped onto a screen — never a
  // pending or rejected creative.
  const { data: ad } = await supabase.from('ads').select('status').eq('id', adId).maybeSingle()
  if (!ad) return { error: 'Ad not found.' }
  if (ad.status !== 'approved' && ad.status !== 'active')
    return { error: 'That ad has not been approved yet.' }

  const { data: tv } = await supabase
    .from('tvs')
    .select('loop_length_seconds, slot_seconds')
    .eq('id', tvId)
    .maybeSingle()
  if (!tv) return { error: 'TV not found.' }

  const cap = maxSlots(tv.loop_length_seconds, tv.slot_seconds)
  const { data: active } = await supabase
    .from('ad_placements')
    .select('slot_position')
    .eq('tv_id', tvId)
    .eq('status', 'active')
  const used = new Set((active ?? []).map((p) => p.slot_position))
  let slot = -1
  for (let i = 0; i < cap; i++) {
    if (!used.has(i)) {
      slot = i
      break
    }
  }
  if (slot < 0) return { error: 'This screen’s loop is full.' }

  // Prefer the ad's active campaign so analytics + lifecycle stay linked.
  const { data: camps } = await supabase
    .from('campaigns')
    .select('id, status')
    .eq('ad_id', adId)
    .order('created_at', { ascending: false })
  const campaignId =
    (camps ?? []).find((c) => c.status === 'active')?.id ?? (camps ?? [])[0]?.id ?? null

  const { error } = await supabase.from('ad_placements').insert({
    ad_id: adId,
    tv_id: tvId,
    campaign_id: campaignId,
    slot_position: slot,
    start_date: new Date().toISOString().slice(0, 10),
    status: 'active',
  })
  if (error) return { error: error.message }

  // Re-adding clears any prior admin exclusion for this campaign↔tv pair.
  if (campaignId) {
    await supabase
      .from('placement_exclusions')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('tv_id', tvId)
  }
  revalidatePath(`/admin/tvs/${tvId}`)
  return { error: null as string | null }
}
