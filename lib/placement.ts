// Placement engine — the core of Loop Network.
//
// Given an ACTIVE campaign whose ad is APPROVED, it decides which screens the ad
// runs on. In the per-TV cart model an advertiser hand-picks venues
// (campaign_targets); the engine fills exactly those venues' screens:
//   1. Host protection — a venue never runs a COMPETITOR's ad in the venue's
//      OWN line of business (venues.category_id); the venue's own host is exempt.
//      There is no general per-category cap — unrelated advertisers freely share
//      a screen. Ads with no category are unrestricted.
//   2. Targeting    — placement is scoped to the campaign's picked venues
//      (campaign_targets). No targets = all eligible venues (legacy fallback).
//   3. Fill         — eligible screens are sorted by foot traffic (desc) and
//      assigned until the (optional) impression goal OR screen cap is reached.
//      Carts run with goal 0, so every picked venue's free TV slots are filled.
//
// Always runs with the service-role admin client (ad_placements is admin-write
// under RLS), so callers must already have authorized the action.
import { createAdminClient } from '@/lib/supabase/admin'
import { categoriesConflict } from '@/lib/categoryConflicts'

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
    .select('id, advertiser_id, ad_id, package_id, territory_id, target_impressions, screen_cap_override, status, is_demo')
    .eq('id', campaignId)
    .maybeSingle()
  if (!camp) return empty('Campaign not found')
  // Hard backstop: a demo campaign is NEVER placed on a real screen, no matter
  // who calls the engine.
  if (camp.is_demo) return empty('Demo campaign — not placed', camp.target_impressions)
  if (camp.status !== 'active') return empty('Campaign is not active', camp.target_impressions)
  if (!camp.ad_id) return empty('Campaign has no ad', camp.target_impressions)

  const { data: ad } = await admin
    .from('ads')
    .select('id, category_id, status, owner_user_id, owner_kind')
    .eq('id', camp.ad_id)
    .maybeSingle()
  if (!ad) return empty('Ad not found', camp.target_impressions)
  if (ad.status !== 'approved' && ad.status !== 'active') {
    return empty('Ad is not approved yet', camp.target_impressions)
  }

  const goal = camp.target_impressions ?? 0

  // Host protection (a venue blocks competitors in its own line of business) is
  // enforced while building candidates below. See the candidate loop.

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

  // ---- 1. Eligible screens (territory, active, not a competitor's line, free slot) ----
  const { data: venuesData } = await admin
    .from('venues')
    .select(
      'id, category_id, foot_traffic_estimate, status, host_user_id, tvs(id, status, loop_length_seconds, slot_seconds)'
    )
    .eq('territory_id', camp.territory_id)
    .eq('status', 'active')
  type V = {
    id: string
    category_id: string | null
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

  // Paid exclusivity: if a DIFFERENT advertiser owns this category exclusively at a
  // venue, this ad can't run there (the exclusive owner's own ad still can). Looked
  // up once for the ad's category across the scoped venues. Non-category ads and
  // ads whose category matches an exclusive THEY own are unaffected.
  const exclusiveByVenue = new Map<string, string>()
  if (ad.category_id) {
    const { data: exRows } = await admin
      .from('exclusive_slots')
      .select('venue_id, advertiser_id')
      .eq('category_id', ad.category_id)
      .eq('status', 'active')
      .in('venue_id', scopedVenues.map((v) => v.id))
    for (const r of (exRows ?? []) as { venue_id: string; advertiser_id: string | null }[]) {
      if (r.advertiser_id) exclusiveByVenue.set(r.venue_id, r.advertiser_id)
    }
  }

  // Admin overrides: screens an admin pulled this campaign off of. The engine
  // must not re-add them (that's the point of the manual override).
  const { data: exclRows } = await admin
    .from('placement_exclusions')
    .select('tv_id')
    .eq('campaign_id', campaignId)
  const excludedTvs = new Set((exclRows ?? []).map((r) => r.tv_id))

  // One read of active placements gives us slot occupancy per TV and which TVs
  // this campaign already runs on.
  const { data: activePl } = await admin
    .from('ad_placements')
    .select('tv_id, campaign_id')
    .eq('status', 'active')
  const usedByTv = new Map<string, number>()
  const myTvs = new Set<string>()
  for (const p of (activePl ?? []) as unknown as {
    tv_id: string
    campaign_id: string | null
  }[]) {
    usedByTv.set(p.tv_id, (usedByTv.get(p.tv_id) ?? 0) + 1)
    if (p.campaign_id === campaignId) myTvs.add(p.tv_id)
  }

  // Host-slot guarantee: reserve one slot per screen for the venue's OWN host
  // promo so paid demand can never crowd it out. The host's own promo
  // (owner_kind='host') ignores the reserve, and TVs that already run their host
  // promo need no reserve (it has its slot). This costs at most one sellable slot
  // per screen — only bites once a screen is otherwise full.
  const isHostPromo = ad.owner_kind === 'host'
  const hostPromoTvs = new Set<string>()
  if (!isHostPromo) {
    const { data: hostPl } = await admin
      .from('ad_placements')
      .select('tv_id, ad:ads!inner(owner_kind)')
      .eq('status', 'active')
      .eq('ad.owner_kind', 'host')
    for (const r of (hostPl ?? []) as unknown as { tv_id: string }[]) hostPromoTvs.add(r.tv_id)
  }

  type Candidate = { tvId: string; venueId: string; traffic: number; slot: number }
  const candidates: Candidate[] = []
  for (const v of scopedVenues) {
    // Host protection: a venue never shows a COMPETITOR's ad. That's the exact
    // same line of business (a barber blocks other barbers) AND cross-category
    // rivals in the same conflict group (a food/drink venue blocks bars,
    // restaurants, cafes, etc. — see lib/categoryConflicts). The venue's own
    // owner is exempt — a host may run their own promo on their own screen.
    if (
      categoriesConflict(ad.category_id, v.category_id) &&
      ad.owner_user_id !== v.host_user_id
    )
      continue
    // Paid exclusivity held by a competitor blocks this venue entirely.
    const exclOwner = exclusiveByVenue.get(v.id)
    if (exclOwner && exclOwner !== camp.advertiser_id) continue
    for (const t of v.tvs ?? []) {
      if (myTvs.has(t.id)) continue // already running here
      if (excludedTvs.has(t.id)) continue // admin pulled this campaign off this screen
      const maxSlots = Math.max(1, Math.floor((t.loop_length_seconds || 360) / (t.slot_seconds || 15)))
      // Hold one slot for the host's own promo (see host-slot guarantee above),
      // except for the host's own promo itself, a 1-slot loop, or a screen whose
      // host promo already holds a slot.
      const reserved = isHostPromo || maxSlots <= 1 || hostPromoTvs.has(t.id) ? 0 : 1
      const used = usedByTv.get(t.id) ?? 0
      if (used >= maxSlots - reserved) continue // loop full (reserve held for host)
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
