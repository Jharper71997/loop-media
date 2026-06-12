'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

function maxSlots(loop: number, slot: number): number {
  return Math.max(1, Math.floor((loop || 360) / (slot || 15)))
}

export async function updateTvLoop(
  id: string,
  input: { loop_length_seconds: number; slot_seconds: number }
) {
  await requireAdmin()
  const supabase = await createClient()
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

// Pull an ad off this screen (kept in history as ended; frees its slot). Also
// record an exclusion so the placement engine won't just re-add it on its next
// run (the override has to stick). See migration 0013.
export async function removePlacement(placementId: string, tvId: string) {
  await requireAdmin()
  const supabase = await createClient()

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
  await requireAdmin()
  const supabase = await createClient()

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
