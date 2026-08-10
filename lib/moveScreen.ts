// Move a campaign from one venue's screens to another's.
//
// Until now the only way to get an ad off a dark screen was to open that screen,
// remove the placement, open a second screen, and add it back. That moved the
// PLACEMENT but left `campaign_targets` pointing at the venue we were trying to
// leave — so the placement cron would put the ad straight back, and the
// advertiser's report kept naming a venue that was never going to show it.
//
// A move is therefore one operation over four tables, not a remove plus an add:
//   campaign_targets      where the campaign is sold
//   exclusive_slots       exclusivity is bought per venue, so it is released, not carried
//   ad_placements         what is actually in a screen's loop today
//   placement_exclusions  the record that stops the cron re-filling the venue we left
//
// Price is held flat whenever the two venues price the same, which is the normal
// case for a like-for-like move — the advertiser bought a screen, they still have
// a screen, and a dark TV is our failure to fix, not theirs to pay for. When the
// tiers genuinely differ the caller is shown the delta first and has to accept it;
// the server re-derives that number and refuses a move whose price moved
// underneath the person approving it.
//
// Server-only: service-role client plus the Stripe secret key.

import { createAdminClient } from '@/lib/supabase/admin'
import { categoriesConflict } from '@/lib/categoryConflicts'
import {
  resolveCartCents,
  resolveAdvertiserContext,
  contextToQuoteOptions,
} from '@/lib/pricing.server'
import { campaignExclusiveVenueIds, releaseExclusiveSlots } from '@/lib/exclusivity'
import { repriceScreens } from '@/lib/screenBilling'
import { placeCampaign } from '@/lib/placement'
import { isTvLive } from '@/lib/format'

type Admin = ReturnType<typeof createAdminClient>

export interface MoveDestination {
  venueId: string
  name: string
  city: string | null
  screens: number
  liveScreens: number
  /** New campaign monthly total if this destination is picked. */
  newMonthlyCents: number
  /** newMonthlyCents − current monthly total. 0 means the price holds. */
  deltaCents: number
}

export interface MoveContext {
  campaignId: string
  adTitle: string
  fromVenueId: string
  fromVenueName: string
  currentMonthlyCents: number
  destinations: MoveDestination[]
  /** Why there is nothing to offer, when destinations is empty. */
  note?: string
}

interface CampaignRow {
  id: string
  advertiser_id: string
  ad_id: string | null
  territory_id: string
  status: string
  monthly_total_cents: number | null
  is_demo: boolean
}

async function loadCampaign(admin: Admin, campaignId: string): Promise<CampaignRow | null> {
  const { data } = await admin
    .from('campaigns')
    .select('id, advertiser_id, ad_id, territory_id, status, monthly_total_cents, is_demo')
    .eq('id', campaignId)
    .maybeSingle()
  return (data as CampaignRow | null) ?? null
}

async function targetVenueIds(admin: Admin, campaignId: string): Promise<string[]> {
  const { data } = await admin
    .from('campaign_targets')
    .select('venue_id')
    .eq('campaign_id', campaignId)
  return (data ?? []).map((r) => r.venue_id as string)
}

// Everywhere this campaign could go instead, priced. Only venues that can
// actually run the ad tomorrow are offered: active, same market, not already on
// the campaign, and not a competitor's own house (host protection) unless the
// advertiser is that host.
export async function moveDestinationsFor(
  campaignId: string,
  fromVenueId: string
): Promise<{ error?: string; context?: MoveContext }> {
  const admin = createAdminClient()

  const camp = await loadCampaign(admin, campaignId)
  if (!camp) return { error: 'Campaign not found.' }
  if (camp.is_demo) return { error: 'Demo campaigns are not placed on real screens.' }
  if (camp.status !== 'active') return { error: 'Only an active campaign can change screens.' }

  const targets = await targetVenueIds(admin, campaignId)
  if (!targets.includes(fromVenueId)) {
    return { error: 'This campaign is not sold on that venue.' }
  }
  if (targets.length < 1) return { error: 'This campaign has no screens.' }

  const [{ data: fromVenue }, { data: adRow }] = await Promise.all([
    admin.from('venues').select('id, name').eq('id', fromVenueId).maybeSingle(),
    camp.ad_id
      ? admin.from('ads').select('title, category_id').eq('id', camp.ad_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (!fromVenue) return { error: 'Venue not found.' }
  const ad = adRow as { title: string; category_id: string | null } | null

  const { data: candidateRows } = await admin
    .from('venues')
    .select('id, name, city, status, category_id, host_user_id, tvs(id, device_id, last_heartbeat_at)')
    .eq('territory_id', camp.territory_id)
    .eq('status', 'active')
    .order('name')

  type Candidate = {
    id: string
    name: string
    city: string | null
    category_id: string | null
    host_user_id: string | null
    tvs: { id: string; device_id: string | null; last_heartbeat_at: string | null }[]
  }
  const targetSet = new Set(targets)
  const candidates = ((candidateRows ?? []) as unknown as Candidate[])
    .filter((v) => !targetSet.has(v.id))
    .filter((v) => (v.tvs ?? []).length > 0)
    // Host protection, same rule the placement engine applies: a venue never runs
    // a competitor's ad in its own line of business. Offering one here would only
    // produce a move the engine then refuses to fill.
    .filter(
      (v) => !(categoriesConflict(ad?.category_id ?? null, v.category_id) && v.host_user_id !== camp.advertiser_id)
    )

  const currentMonthly = camp.monthly_total_cents ?? 0
  const ctx = await resolveAdvertiserContext(camp.advertiser_id)
  const quoteOpts = contextToQuoteOptions(ctx)
  const held = await campaignExclusiveVenueIds(admin, campaignId)
  // Exclusivity is bought at a named venue, so it does not travel with the move.
  const keptExclusives = held.filter((v) => v !== fromVenueId)
  const remaining = targets.filter((v) => v !== fromVenueId)

  const destinations: MoveDestination[] = []
  for (const v of candidates) {
    const { totalCents } = await resolveCartCents([...remaining, v.id], quoteOpts, keptExclusives)
    if (!totalCents) continue
    destinations.push({
      venueId: v.id,
      name: v.name,
      city: v.city,
      screens: v.tvs.length,
      liveScreens: v.tvs.filter((t) => !!t.device_id && isTvLive(t.last_heartbeat_at)).length,
      newMonthlyCents: totalCents,
      deltaCents: totalCents - currentMonthly,
    })
  }

  // A screen that is on and priced the same comes first: it is the move that
  // fixes the problem today without changing anyone's bill.
  destinations.sort(
    (a, b) =>
      Number(b.liveScreens > 0) - Number(a.liveScreens > 0) ||
      Math.abs(a.deltaCents) - Math.abs(b.deltaCents) ||
      a.name.localeCompare(b.name)
  )

  return {
    context: {
      campaignId,
      adTitle: ad?.title ?? 'This ad',
      fromVenueId,
      fromVenueName: fromVenue.name as string,
      currentMonthlyCents: currentMonthly,
      destinations,
      note: destinations.length
        ? undefined
        : 'No other active venue in this market can take this ad right now.',
    },
  }
}

export interface MoveResult {
  error?: string
  moved?: {
    fromVenueName: string
    toVenueName: string
    newMonthlyCents: number
    deltaCents: number
    placementsEnded: number
    placementsCreated: number
    /** Set when the ad could not be slotted at the destination yet. */
    warning?: string
  }
}

// Do the move. `acceptDeltaCents` is what the person approving it was shown; if
// the server re-derives a different number the move is refused rather than
// quietly re-billing them.
export async function moveCampaignScreen(
  campaignId: string,
  fromVenueId: string,
  toVenueId: string,
  acceptDeltaCents: number
): Promise<MoveResult> {
  const admin = createAdminClient()

  const camp = await loadCampaign(admin, campaignId)
  if (!camp) return { error: 'Campaign not found.' }
  if (camp.is_demo) return { error: 'Demo campaigns are not placed on real screens.' }
  if (camp.status !== 'active') return { error: 'Only an active campaign can change screens.' }
  if (fromVenueId === toVenueId) return { error: 'Pick a different venue.' }

  const targets = await targetVenueIds(admin, campaignId)
  if (!targets.includes(fromVenueId)) return { error: 'This campaign is not sold on that venue.' }
  if (targets.includes(toVenueId)) return { error: 'This campaign already runs at that venue.' }

  const { data: venueRows } = await admin
    .from('venues')
    .select('id, name, status, territory_id, category_id, host_user_id')
    .in('id', [fromVenueId, toVenueId])
  type V = {
    id: string
    name: string
    status: string
    territory_id: string
    category_id: string | null
    host_user_id: string | null
  }
  const vs = (venueRows ?? []) as V[]
  const from = vs.find((v) => v.id === fromVenueId)
  const to = vs.find((v) => v.id === toVenueId)
  if (!from || !to) return { error: 'Venue not found.' }
  if (to.status !== 'active') return { error: `${to.name} is not active, so it cannot take an ad.` }
  if (to.territory_id !== camp.territory_id) return { error: `${to.name} is in another market.` }

  const { data: destTvs } = await admin.from('tvs').select('id').eq('venue_id', toVenueId)
  if (!(destTvs ?? []).length) return { error: `${to.name} has no screen to move this ad onto.` }

  let adCategory: string | null = null
  if (camp.ad_id) {
    const { data: ad } = await admin
      .from('ads')
      .select('category_id')
      .eq('id', camp.ad_id)
      .maybeSingle()
    adCategory = ad?.category_id ?? null
  }
  if (categoriesConflict(adCategory, to.category_id) && to.host_user_id !== camp.advertiser_id) {
    return { error: `${to.name} does not run ads from its own line of business.` }
  }

  // ---- price the move ----
  const currentMonthly = camp.monthly_total_cents ?? 0
  const held = await campaignExclusiveVenueIds(admin, campaignId)
  const keptExclusives = held.filter((v) => v !== fromVenueId)
  const nextTargets = [...targets.filter((v) => v !== fromVenueId), toVenueId]
  const ctx = await resolveAdvertiserContext(camp.advertiser_id)
  const { totalCents } = await resolveCartCents(
    nextTargets,
    contextToQuoteOptions(ctx),
    keptExclusives
  )
  if (!totalCents) return { error: 'Could not price the move. Try again.' }

  const delta = totalCents - currentMonthly
  if (delta !== Math.round(acceptDeltaCents)) {
    return {
      error: 'The price of this move changed while you were looking at it. Reload and try again.',
    }
  }

  // Bill first, exactly as the add and remove paths do: if the rate change fails
  // we must not have already taken the screens away.
  if (delta !== 0) {
    const { data: sub } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('campaign_id', campaignId)
      .maybeSingle()
    const subId = (sub?.stripe_subscription_id as string | null) ?? null
    if (subId && process.env.STRIPE_SECRET_KEY) {
      try {
        await repriceScreens(subId, totalCents, 'create_prorations')
      } catch (e) {
        const why = e instanceof Error ? ` (${e.message})` : ''
        return { error: `Billing could not be updated${why}. Nothing was moved.` }
      }
    }
  }

  // ---- move where it is sold ----
  await admin
    .from('campaign_targets')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('venue_id', fromVenueId)
  await admin
    .from('campaign_targets')
    .upsert(
      { campaign_id: campaignId, venue_id: toVenueId },
      { onConflict: 'campaign_id,venue_id', ignoreDuplicates: true }
    )

  // Exclusivity was bought at the venue we are leaving; free it for resale.
  await releaseExclusiveSlots(admin, campaignId, [fromVenueId])

  // ---- move what is in the loop ----
  const { data: fromTvs } = await admin.from('tvs').select('id').eq('venue_id', fromVenueId)
  const fromTvIds = (fromTvs ?? []).map((t) => t.id as string)
  let placementsEnded = 0
  if (fromTvIds.length) {
    const { data: ended } = await admin
      .from('ad_placements')
      .update({ status: 'ended', end_date: new Date().toISOString().slice(0, 10) })
      .eq('campaign_id', campaignId)
      .eq('status', 'active')
      .in('tv_id', fromTvIds)
      .select('id')
    placementsEnded = (ended ?? []).length

    // Without this the cron re-fills the venue we just left the moment it runs.
    await admin.from('placement_exclusions').upsert(
      fromTvIds.map((tvId) => ({ campaign_id: campaignId, tv_id: tvId })),
      { onConflict: 'campaign_id,tv_id', ignoreDuplicates: true }
    )
  }

  // ...and clear any old exclusion at the destination, or the engine will skip it.
  const destTvIds = (destTvs ?? []).map((t) => t.id as string)
  await admin
    .from('placement_exclusions')
    .delete()
    .eq('campaign_id', campaignId)
    .in('tv_id', destTvIds)

  await admin.from('campaigns').update({ monthly_total_cents: totalCents }).eq('id', campaignId)

  // Let the real engine fill the destination so slot choice, caps and paid
  // exclusivity are decided in exactly one place.
  const outcome = await placeCampaign(campaignId, admin)

  return {
    moved: {
      fromVenueName: from.name,
      toVenueName: to.name,
      newMonthlyCents: totalCents,
      deltaCents: delta,
      placementsEnded,
      placementsCreated: outcome.created,
      warning: outcome.created
        ? undefined
        : `The ad is now sold at ${to.name} but could not be slotted yet${outcome.reason ? ` — ${outcome.reason.toLowerCase()}` : ''}. Check the screen's loop.`,
    },
  }
}
