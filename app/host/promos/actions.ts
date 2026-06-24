'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile } from '@/lib/auth'

const FREE_PROMO_SLOTS = 2

export interface HostPromoInput {
  target_venue_id: string // an OTHER venue the host wants to run their promo on
  title: string
  creative_type: 'video' | 'image'
  creative_url: string
  qr_target_url: string | null
}

// A host's free perk: run their own promo on OTHER venues' screens around the
// network (not their own screen). Modeled as a normal $0 campaign so it flows
// through the same approval + placement engine as paid ads: on admin approval,
// approveAd → activatePlacementsIfReady → placeCampaign places it on the picked
// venue's screens. Capped at FREE_PROMO_SLOTS (one screen each).
export async function submitHostPromo(
  input: HostPromoInput
): Promise<{ error: string | null }> {
  const profile = await requireProfile()
  if (profile.role !== 'host' && profile.role !== 'admin') {
    return { error: 'Only host venues can add promos.' }
  }
  if (!input.title.trim()) return { error: 'Give your promo a title.' }
  if (!input.creative_url) return { error: 'Upload a promo image or video.' }
  if (!input.qr_target_url?.trim()) return { error: 'Add a scan link for your promo.' }
  if (!input.target_venue_id) return { error: 'Pick a screen to run your promo on.' }

  const supabase = await createClient()

  // The host's own venues define their market (territory) and business category
  // (for exclusivity). A host with no venue has nothing to anchor a promo to.
  const { data: ownVenues } = await supabase
    .from('venues')
    .select('id, territory_id, category_id')
    .eq('host_user_id', profile.id)
  const owned = ownVenues ?? []
  if (!owned.length) {
    return { error: 'Set up your own screen first, then you can run promos on the network.' }
  }
  const territoryId = owned.find((v) => v.territory_id)?.territory_id ?? null
  const hostCategory = owned.find((v) => v.category_id)?.category_id ?? null
  const ownedIds = new Set(owned.map((v) => v.id))

  // The target must be a real OTHER venue in the host's market, on the map.
  const { data: target } = await supabase
    .from('venues')
    .select('id, territory_id, category_id, host_user_id, status, lat, lng')
    .eq('id', input.target_venue_id)
    .maybeSingle()
  if (!target || ownedIds.has(target.id)) {
    return { error: 'Pick a screen at a different venue than your own.' }
  }
  if (target.status !== 'active' || target.lat == null || target.lng == null) {
    return { error: 'That screen is not available right now. Pick another.' }
  }
  if (territoryId && target.territory_id !== territoryId) {
    return { error: 'That screen is in a different market.' }
  }
  // Category exclusivity: a business can't advertise on a competitor's screen.
  if (hostCategory && target.category_id === hostCategory) {
    return { error: "That screen is in your own line of business, so you can't advertise there. Pick a different venue." }
  }

  // Enforce the free-slot allotment (one screen per promo). The DB trigger is a
  // looser backstop; this is the real cap the UI shows.
  const { count } = await supabase
    .from('ads')
    .select('id', { count: 'exact', head: true })
    .eq('owner_user_id', profile.id)
    .eq('owner_kind', 'host')
    .neq('status', 'rejected')
  if ((count ?? 0) >= FREE_PROMO_SLOTS) {
    return { error: `You're using all ${FREE_PROMO_SLOTS} free promo slots. Remove one to add another.` }
  }

  // 1) The creative (pending → admin review, same gate as paid ads).
  const { data: ad, error: adErr } = await supabase
    .from('ads')
    .insert({
      owner_user_id: profile.id,
      owner_kind: 'host',
      territory_id: target.territory_id,
      category_id: hostCategory, // the host's business category drives exclusivity
      title: input.title.trim(),
      creative_type: input.creative_type,
      creative_url: input.creative_url,
      status: 'pending',
      qr_target_url: input.qr_target_url.trim(),
    })
    .select('id')
    .single()
  if (adErr || !ad) {
    if (adErr && /promo limit/i.test(adErr.message)) {
      return { error: `You're using all your free promo slots. Remove one to add another.` }
    }
    return { error: adErr?.message ?? 'Could not create promo.' }
  }

  // 2) A $0 campaign — no Stripe, active immediately. Placement waits on approval.
  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .insert({
      advertiser_id: profile.id,
      ad_id: ad.id,
      package_id: null,
      territory_id: target.territory_id,
      monthly_total_cents: 0,
      status: 'active',
    })
    .select('id')
    .single()
  if (cErr || !campaign) {
    // Roll back the orphaned ad so the slot isn't silently consumed.
    await supabase.from('ads').delete().eq('id', ad.id)
    return { error: cErr?.message ?? 'Could not create promo.' }
  }

  // 3) The cart = the single picked screen's venue.
  const { error: tErr } = await supabase
    .from('campaign_targets')
    .insert({ campaign_id: campaign.id, venue_id: target.id })
  if (tErr) {
    await supabase.from('campaigns').delete().eq('id', campaign.id)
    await supabase.from('ads').delete().eq('id', ad.id)
    return { error: tErr.message }
  }

  revalidatePath('/host/promos')
  revalidatePath('/host')
  return { error: null }
}

export async function deleteHostPromo(id: string): Promise<{ error: string | null }> {
  const profile = await requireProfile()
  if (profile.role !== 'host' && profile.role !== 'admin') return { error: 'Not allowed.' }

  const supabase = await createClient()
  // Confirm ownership before tearing anything down.
  const { data: ad } = await supabase
    .from('ads')
    .select('id, owner_user_id, owner_kind')
    .eq('id', id)
    .maybeSingle()
  if (!ad || ad.owner_user_id !== profile.id || ad.owner_kind !== 'host') {
    return { error: 'Not allowed.' }
  }

  // campaigns.ad_id is ON DELETE SET NULL, so deleting the ad would orphan the
  // campaign. Delete the campaign first (cascades campaign_targets + placements),
  // then the ad. Service role: ad_placements is admin-write under RLS.
  const admin = createAdminClient()
  await admin.from('campaigns').delete().eq('ad_id', id).eq('advertiser_id', profile.id)
  const { error } = await admin.from('ads').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/host/promos')
  revalidatePath('/host')
  return { error: null }
}
