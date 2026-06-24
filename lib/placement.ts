// Placement engine — the core of Loop Network.
//
// Given an ACTIVE campaign whose ad is APPROVED, it decides which screens the ad
// runs on. In the per-TV cart model an advertiser hand-picks venues
// (campaign_targets); the engine fills exactly those venues' screens:
//   1. Exclusivity  — per VENUE per CATEGORY: a venue holds at most
//      venues.category_slots DISTINCT advertisers of a given category (1 = full
//      exclusivity). Ads with no category are unrestricted.
//   2. Targeting    — placement is scoped to the campaign's picked venues
//      (campaign_targets). No targets = all eligible venues (legacy fallback).
//   3. Fill         — eligible screens are sorted by foot traffic (desc) and
//      assigned until the (optional) impression goal OR screen cap is reached.
//      Carts run with goal 0, so every picked venue's free TV slots are filled.
//
// Always runs with the service-role admin client (ad_placements is admin-write
// under RLS), so callers must already have authorized the action.
import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_MAX_SLOTS = 24 // 360s loop / 15s slot

export interface PlacementOutcome {
  ok: boolean
  reason?: string
  created: number
  screens: number
  estImpressions: number
  goal: number
  goalMet: boolean
  capReached: boolean
}

function empty(reason: string, goal = 0): PlacementOutcome {
  return { ok: false, reason, created: 0, screens: 0, estImpressions: 0, goal, goalMet: false, capReached: false }
}

type Admin = ReturnType<typeof createAdminClient>

// Run the engine for one campaign. Idempotent-ish: only ADDS placements on
// screens this campaign isn't already running, up to the goal/cap.
export async function placeCampaign(
  campaignId: string,
  client?: Admin
): Promise<PlacementOutcome> {
  const admin = client ?? createAdminClient()

  const { data: camp } = await admin
    .from('campaigns')
    .select('id, advertiser_id, ad_id, package_id, territory_id, target_impressions, screen_cap_override, status')
    .eq('id', campaignId)
    .maybeSingle()
  if (!camp) return empty('Campaign not found')
  if (camp.status !== 'active') return empty('Campaign is not active', camp.target_impressions)
  if (!camp.ad_id) return empty('Campaign has no ad', camp.target_impressions)

  const { data: ad } = await admin
    .from('ads')
    .select('id, category_id, status, owner_user_id')
    .eq('id', camp.ad_id)
    .maybeSingle()
  if (!ad) return empty('Ad not found', camp.target_impressions)
  if (ad.status !== 'approved' && ad.status !== 'active') {
    return empty('Ad is not approved yet', camp.target_impressions)
  }

  const goal = camp.target_impressions ?? 0

  // Exclusivity is now enforced PER VENUE (venues.category_slots) while building
  // candidates below, not as a per-territory cap. See the candidate loop.

  // ---- screen cap = min(package cap, per-campaign override) ----
  // Either may be null (no limit); the effective cap is the tightest non-null one.
  let screenCap: number | null = null
  if (camp.package_id) {
    const { data: pkg } = await admin
      .from('packages')
      .select('screen_cap')
      .eq('id', camp.package_id)
      .maybeSingle()
    screenCap = pkg?.screen_cap ?? null
  }
  const override = camp.screen_cap_override ?? null
  if (override != null) {
    screenCap = screenCap == null ? override : Math.min(screenCap, override)
  }

  // ---- 1. Eligible screens (territory, active, category slots free, free slot) ----
  const { data: venuesData } = await admin
    .from('venues')
    .select(
      'id, category_id, category_slots, foot_traffic_estimate, status, host_user_id, tvs(id, status, loop_length_seconds, slot_seconds)'
    )
    .eq('territory_id', camp.territory_id)
    .eq('status', 'active')
  type V = {
    id: string
    category_id: string | null
    category_slots: number | null
    foot_traffic_estimate: number
    host_user_id: string | null
    tvs: { id: string; loop_length_seconds: number; slot_seconds: number }[]
  }
  const venues = (venuesData ?? []) as unknown as V[]

  // Target-driven: an ad runs ONLY on the screens the advertiser picked
  // (campaign_targets). No targets = nothing to place (admins assign manually).
  const { data: targetRows } = await admin
    .from('campaign_targets')
    .select('venue_id')
    .eq('campaign_id', campaignId)
  const targetIds = new Set((targetRows ?? []).map((r) => r.venue_id))
  if (!targetIds.size) return empty('No screens selected', goal)
  const scopedVenues = venues.filter((v) => targetIds.has(v.id))

  // Admin overrides: screens an admin pulled this campaign off of. The engine
  // must not re-add them (that's the point of the manual override).
  const { data: exclRows } = await admin
    .from('placement_exclusions')
    .select('tv_id')
    .eq('campaign_id', campaignId)
  const excludedTvs = new Set((exclRows ?? []).map((r) => r.tv_id))

  // One read of active placements gives us slot occupancy per TV, which TVs this
  // campaign already runs on, and per-venue category occupancy (distinct OTHER
  // advertisers running each category at each venue) for exclusivity.
  const tvToVenue = new Map<string, string>()
  for (const v of venues) for (const t of v.tvs ?? []) tvToVenue.set(t.id, v.id)

  const { data: activePl } = await admin
    .from('ad_placements')
    .select('tv_id, campaign_id, ad:ads(category_id, owner_user_id)')
    .eq('status', 'active')
  const usedByTv = new Map<string, number>()
  const myTvs = new Set<string>()
  const venueCatAdvertisers = new Map<string, Map<string, Set<string>>>() // venue -> cat -> advertisers
  for (const p of (activePl ?? []) as unknown as {
    tv_id: string
    campaign_id: string | null
    ad: { category_id: string | null; owner_user_id: string } | null
  }[]) {
    usedByTv.set(p.tv_id, (usedByTv.get(p.tv_id) ?? 0) + 1)
    if (p.campaign_id === campaignId) myTvs.add(p.tv_id)
    const venueId = tvToVenue.get(p.tv_id)
    const pad = Array.isArray(p.ad) ? p.ad[0] : p.ad
    if (venueId && pad?.category_id) {
      let byCat = venueCatAdvertisers.get(venueId)
      if (!byCat) venueCatAdvertisers.set(venueId, (byCat = new Map()))
      let advs = byCat.get(pad.category_id)
      if (!advs) byCat.set(pad.category_id, (advs = new Set()))
      advs.add(pad.owner_user_id)
    }
  }

  type Candidate = { tvId: string; venueId: string; traffic: number; slot: number }
  const candidates: Candidate[] = []
  for (const v of scopedVenues) {
    // Venue-own-category exclusivity: a venue never shows a COMPETITOR's ad in
    // its OWN line of business (protects the host from direct competitors). The
    // venue's own owner is exempt — a host may run their own promo on their own
    // screen even in their category.
    if (
      ad.category_id &&
      ad.category_id === v.category_id &&
      ad.owner_user_id !== v.host_user_id
    )
      continue
    // Per-venue category exclusivity: if this ad has a category, the venue can
    // hold at most category_slots DISTINCT advertisers of that category. This
    // advertiser is always allowed to (re)fill its own slot.
    if (ad.category_id) {
      const advs = new Set(venueCatAdvertisers.get(v.id)?.get(ad.category_id) ?? [])
      advs.delete(camp.advertiser_id)
      if (advs.size >= (v.category_slots ?? 1)) continue // category full at this venue
    }
    for (const t of v.tvs ?? []) {
      if (myTvs.has(t.id)) continue // already running here
      if (excludedTvs.has(t.id)) continue // admin pulled this campaign off this screen
      const maxSlots = Math.max(1, Math.floor((t.loop_length_seconds || 360) / (t.slot_seconds || 15)))
      const used = usedByTv.get(t.id) ?? 0
      if (used >= maxSlots) continue // loop full
      candidates.push({ tvId: t.id, venueId: v.id, traffic: v.foot_traffic_estimate ?? 0, slot: used })
    }
  }
  candidates.sort((a, b) => b.traffic - a.traffic)

  // ---- 3. Greedy goal fill ----
  const today = new Date().toISOString().slice(0, 10)
  const rows: {
    ad_id: string
    tv_id: string
    campaign_id: string
    slot_position: number
    start_date: string
    status: 'active'
  }[] = []
  const screensUsed = new Set<string>(myTvs) // count already-running screens toward the cap
  let est = 0
  let capReached = false

  for (const c of candidates) {
    if (screenCap != null && screensUsed.size >= screenCap) {
      capReached = true
      break
    }
    // Target-driven: fill every free slot at the picked venues (no goal-based
    // early stop). screen_cap above is the only ceiling, and carts have none.
    rows.push({
      ad_id: ad.id,
      tv_id: c.tvId,
      campaign_id: campaignId,
      slot_position: c.slot,
      start_date: today,
      status: 'active',
    })
    est += c.traffic
    screensUsed.add(c.tvId)
  }

  if (rows.length) {
    const { error } = await admin.from('ad_placements').insert(rows)
    if (error) return { ...empty(error.message, goal), screens: screensUsed.size }
    // Reflect "live" on the ad.
    await admin.from('ads').update({ status: 'active' }).eq('id', ad.id)
  }

  return {
    ok: true,
    created: rows.length,
    screens: screensUsed.size,
    estImpressions: est, // impressions from THIS run's new placements
    goal,
    goalMet: goal > 0 ? est >= goal : true,
    capReached,
  }
}

// Place only if BOTH gates are satisfied: campaign active (paid) AND ad approved.
// Safe to call from any lifecycle event — it no-ops until the pair is ready.
export async function activatePlacementsIfReady(
  campaignId: string,
  client?: Admin
): Promise<PlacementOutcome | null> {
  const admin = client ?? createAdminClient()
  const { data: camp } = await admin
    .from('campaigns')
    .select('id, ad_id, status')
    .eq('id', campaignId)
    .maybeSingle()
  if (!camp || camp.status !== 'active' || !camp.ad_id) return null
  const { data: ad } = await admin.from('ads').select('status').eq('id', camp.ad_id).maybeSingle()
  if (!ad || (ad.status !== 'approved' && ad.status !== 'active')) return null
  return placeCampaign(campaignId, admin)
}

// Place a host's free promo onto every screen at the host's OWN venue. Host
// promos have no campaign, so the campaign engine above never touches them —
// without this an approved promo sits "approved" but never appears on the TV.
// Idempotent: skips screens already running this promo and full loops. Safe to
// call on any ad — no-ops for advertiser ads. Call AFTER the promo is approved.
export async function placeHostPromo(
  adId: string,
  client?: Admin
): Promise<PlacementOutcome> {
  const admin = client ?? createAdminClient()

  const { data: ad } = await admin
    .from('ads')
    .select('id, status, owner_kind, host_venue_id')
    .eq('id', adId)
    .maybeSingle()
  if (!ad) return empty('Ad not found')
  if (ad.owner_kind !== 'host' || !ad.host_venue_id) return empty('Not a host promo')
  if (ad.status !== 'approved' && ad.status !== 'active') return empty('Promo is not approved yet')

  const { data: venue } = await admin
    .from('venues')
    .select('id, tvs(id, loop_length_seconds, slot_seconds)')
    .eq('id', ad.host_venue_id)
    .maybeSingle()
  const tvs = ((venue?.tvs ?? []) as unknown as {
    id: string
    loop_length_seconds: number
    slot_seconds: number
  }[])
  if (!tvs.length) return empty('No screens at this venue')

  // Existing active placements on these screens: which slots are taken, and
  // which screens already run this promo (so we never double-place).
  const tvIds = tvs.map((t) => t.id)
  const { data: existing } = await admin
    .from('ad_placements')
    .select('tv_id, slot_position, ad_id')
    .in('tv_id', tvIds)
    .eq('status', 'active')
  const usedByTv = new Map<string, Set<number>>()
  const alreadyOnTv = new Set<string>()
  for (const p of existing ?? []) {
    if (!usedByTv.has(p.tv_id)) usedByTv.set(p.tv_id, new Set())
    usedByTv.get(p.tv_id)!.add(p.slot_position)
    if (p.ad_id === adId) alreadyOnTv.add(p.tv_id)
  }

  const today = new Date().toISOString().slice(0, 10)
  const rows: {
    ad_id: string
    tv_id: string
    campaign_id: null
    slot_position: number
    start_date: string
    status: 'active'
  }[] = []
  for (const t of tvs) {
    if (alreadyOnTv.has(t.id)) continue // promo already running on this screen
    const cap = Math.max(1, Math.floor((t.loop_length_seconds || 360) / (t.slot_seconds || 15)))
    const used = usedByTv.get(t.id) ?? new Set<number>()
    let slot = -1
    for (let i = 0; i < cap; i++) {
      if (!used.has(i)) {
        slot = i
        break
      }
    }
    if (slot < 0) continue // loop full
    rows.push({
      ad_id: adId,
      tv_id: t.id,
      campaign_id: null,
      slot_position: slot,
      start_date: today,
      status: 'active',
    })
  }

  if (rows.length) {
    const { error } = await admin.from('ad_placements').insert(rows)
    if (error) return { ...empty(error.message), screens: rows.length }
    // Reflect "live" on the ad, mirroring the campaign engine.
    await admin.from('ads').update({ status: 'active' }).eq('id', adId)
  }
  return {
    ok: true,
    created: rows.length,
    screens: rows.length,
    estImpressions: 0,
    goal: 0,
    goalMet: true,
    capReached: false,
  }
}
