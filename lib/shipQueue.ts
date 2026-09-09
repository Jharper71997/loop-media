// Ship — one ad's journey from paid to on screen, as a single ordered queue.
//
// Getting an advertiser live was spread across four places that each knew one
// step and none of which knew the sequence: /admin/money knew who had paid,
// /admin/creative knew who was waiting on us to make something, /admin/queue
// knew what needed reviewing, and whether an approved ad was actually PLACED on
// a screen was not shown anywhere at all. An ad could sit approved and unplaced
// indefinitely and the only symptom was an advertiser eventually asking why they
// had never seen their spot.
//
// This module states the sequence and puts every ad on exactly one step of it,
// so "what is between a signed advertiser and their ad playing" is one list.
//
//   1. paid       — money taken, no creative exists yet
//   2. building   — they asked us to make it; we owe them
//   3. review     — submitted, waiting on you
//   4. placing    — cleared to air, but on no live screen
//   5. rejected   — reviewed and turned down; it can never air as it stands
//   6. paused     — deliberately off
//   7. live       — running
//
// An ad is CLEARED TO AIR at status 'approved' OR 'active'. Both are real: the
// admin queue approves to 'approved', and the placement engine flips the ad to
// 'active' the moment it puts it on a screen (lib/placement.ts). Reading only
// 'approved' as cleared filed every genuinely-running ad under "paid, nothing
// made" — the loudest possible false alarm, on the accounts that were fine.
//
// A step is a state of the WORLD, derived every load. Nothing here is a status
// column somebody has to remember to update.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export type ShipStep = 'paid' | 'building' | 'review' | 'placing' | 'rejected' | 'paused' | 'live'

export const STEP_ORDER: ShipStep[] = [
  'paid',
  'building',
  'review',
  'placing',
  'rejected',
  'paused',
  'live',
]

/** Ad statuses that are cleared to air. 'active' is what the placement engine
 *  sets once the ad is actually on screens, so it is a success state, not a
 *  problem — see the note at the top of this file. */
const CLEARED = new Set(['approved', 'active'])

export const STEP_LABEL: Record<ShipStep, string> = {
  paid: 'Paid, nothing made',
  building: 'We owe them creative',
  review: 'Waiting on your review',
  placing: 'Approved, not on a screen',
  rejected: 'Rejected, still being paid for',
  paused: 'Paused, not airing',
  live: 'Running',
}

export const STEP_NOTE: Record<ShipStep, string> = {
  paid: 'Money taken and no ad exists. Every day here is a day they paid for nothing.',
  building: 'They asked us to build it. Nothing moves until we do.',
  review: 'Submitted and blocked on you. This is the fastest thing on the page to clear.',
  placing: 'Approved and airing nowhere. The work is done; it just was not put on a screen.',
  rejected: 'Turned down at review. It will never air as it stands — they need new creative.',
  paused: 'Switched off on purpose. Only fine if the billing stopped too.',
  live: 'On at least one live screen.',
}

/** Whether a step is work. `live` is the finish line, not a task. */
export const STEP_IS_WORK: Record<ShipStep, boolean> = {
  paid: true,
  building: true,
  review: true,
  placing: true,
  rejected: true,
  paused: true,
  live: false,
}

export interface ShipItem {
  id: string
  step: ShipStep
  /** The ad, or the campaign when there is no ad yet. */
  title: string
  advertiserName: string
  advertiserId: string | null
  monthlyCents: number
  /** How long it has been sitting on this step. */
  since: string | null
  /** Live screens it is placed on, once it gets that far. A placement at a venue
   *  that has left the network is not a screen anybody is watching. */
  screens: number
  /** One line of what is actually blocking it. */
  blocker: string
  href: string
}

type CampaignRow = {
  id: string
  ad_id: string | null
  advertiser_id: string
  status: string
  monthly_total_cents: number | null
  created_at: string
  is_demo: boolean
  ad: { id: string; title: string; status: string; created_at: string } | null
  advertiser: { id: string; full_name: string | null; email: string } | null
}

const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

export const loadShipQueue = cache(async (territoryId: string | null): Promise<ShipItem[]> => {
  const supabase = await createClient()

  let cq = supabase
    .from('campaigns')
    .select(
      'id, ad_id, advertiser_id, status, monthly_total_cents, created_at, is_demo, ad:ads(id, title, status, created_at), advertiser:profiles!advertiser_id(id, full_name, email)'
    )
    .in('status', ['active', 'paused'])
  if (territoryId) cq = cq.eq('territory_id', territoryId)

  const [{ data: campData }, { data: creativeData }] = await Promise.all([
    cq,
    // Everything an advertiser has asked us to build that is not finished.
    supabase
      .from('creative_requests')
      .select('id, brief, status, created_at, advertiser_id')
      .neq('status', 'done'),
  ])

  const campaigns = ((campData ?? []) as unknown as CampaignRow[])
    .map((c) => ({ ...c, ad: one(c.ad), advertiser: one(c.advertiser) }))
    .filter((c) => !c.is_demo)
  if (!campaigns.length) return []

  // Where each campaign is actually placed. An approved ad on zero screens is
  // the failure this queue exists to make visible.
  // A placement only counts if the venue is still in the network — a row pointing
  // at a screen in a venue that went inactive is not somebody seeing the ad, and
  // counting it hides the exact failure this page is for.
  const { data: placeData } = await supabase
    .from('ad_placements')
    .select('campaign_id, tv:tvs!inner(venue:venues!inner(status))')
    .eq('status', 'active')
    .eq('tv.venue.status', 'active')
    .in(
      'campaign_id',
      campaigns.map((c) => c.id)
    )
  const screensByCampaign = new Map<string, number>()
  for (const p of (placeData ?? []) as unknown as { campaign_id: string | null }[]) {
    if (!p.campaign_id) continue
    screensByCampaign.set(p.campaign_id, (screensByCampaign.get(p.campaign_id) ?? 0) + 1)
  }

  // creative_requests is keyed to the ADVERTISER, not a campaign (0001_init), so
  // an open request marks every campaign that advertiser has. That is the right
  // reading anyway: if we owe someone a spot, none of their money is earning.
  const openRequestByAdvertiser = new Map<string, { id: string; brief: string; created_at: string }>()
  for (const r of (creativeData ?? []) as {
    id: string
    brief: string
    status: string
    created_at: string
    advertiser_id: string | null
  }[]) {
    if (!r.advertiser_id || openRequestByAdvertiser.has(r.advertiser_id)) continue
    openRequestByAdvertiser.set(r.advertiser_id, {
      id: r.id,
      brief: r.brief,
      created_at: r.created_at,
    })
  }

  const out: ShipItem[] = []
  for (const c of campaigns) {
    const advertiserName = c.advertiser?.full_name ?? c.advertiser?.email ?? 'Unknown advertiser'
    const monthlyCents = c.monthly_total_cents ?? 0
    const screens = screensByCampaign.get(c.id) ?? 0
    const request = openRequestByAdvertiser.get(c.advertiser_id)

    const base = {
      id: c.id,
      advertiserName,
      advertiserId: c.advertiser?.id ?? c.advertiser_id,
      monthlyCents,
      screens,
    }

    // Order matters: the FIRST thing true is what is blocking them. An ad that
    // does not exist cannot be waiting on review.
    if (request) {
      out.push({
        ...base,
        step: 'building',
        title: c.ad?.title ?? 'Creative request',
        since: request.created_at,
        blocker: request.brief.slice(0, 140),
        href: '/admin/creative',
      })
      continue
    }

    if (!c.ad) {
      out.push({
        ...base,
        step: 'paid',
        title: 'No ad yet',
        since: c.created_at,
        blocker: 'Paid and there is no creative on the account at all',
        href: `/admin/advertisers/${c.advertiser_id}`,
      })
      continue
    }

    if (c.ad.status === 'pending') {
      out.push({
        ...base,
        step: 'review',
        title: c.ad.title,
        since: c.ad.created_at,
        blocker: 'Submitted and waiting on approval',
        href: '/admin/queue',
      })
      continue
    }

    if (c.ad.status === 'rejected') {
      out.push({
        ...base,
        step: 'rejected',
        title: c.ad.title,
        since: c.ad.created_at,
        blocker: 'Rejected at review — it needs new creative before it can air',
        href: '/admin/queue',
      })
      continue
    }

    // Paused is a decision, not a breakdown. It still earns a line, because the
    // money usually did not pause with it.
    if (c.status === 'paused' || c.ad.status === 'paused') {
      out.push({
        ...base,
        step: 'paused',
        title: c.ad.title,
        since: c.ad.created_at,
        blocker:
          c.status === 'paused'
            ? 'Campaign paused — check the billing stopped too'
            : 'Ad paused — the campaign is still active',
        href: `/admin/advertisers/${c.advertiser_id}`,
      })
      continue
    }

    if (CLEARED.has(c.ad.status) && screens === 0) {
      out.push({
        ...base,
        step: 'placing',
        title: c.ad.title,
        since: c.ad.created_at,
        blocker: 'Approved but placed on no screen — nobody is seeing it',
        href: `/admin/advertisers/${c.advertiser_id}`,
      })
      continue
    }

    if (CLEARED.has(c.ad.status)) {
      out.push({
        ...base,
        step: 'live',
        title: c.ad.title,
        since: c.ad.created_at,
        blocker: `On ${screens} screen${screens === 1 ? '' : 's'}`,
        href: `/admin/advertisers/${c.advertiser_id}`,
      })
      continue
    }

    // Anything an ad row can be that is not handled above: it is not on its way
    // to a screen, and saying so is better than leaving it off the list.
    out.push({
      ...base,
      step: 'rejected',
      title: c.ad.title,
      since: c.ad.created_at,
      blocker: `Ad is ${c.ad.status} — it cannot air until that changes`,
      href: '/admin/queue',
    })
  }

  return out.sort(
    (a, b) =>
      STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step) ||
      b.monthlyCents - a.monthlyCents ||
      a.advertiserName.localeCompare(b.advertiserName)
  )
})
