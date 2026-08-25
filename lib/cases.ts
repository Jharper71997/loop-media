// Cases — everything that is BROKEN, one row each, with money attached.
//
// The old admin answered "what is in the database". You had to already suspect a
// problem to go find it: dark screens on the uptime page, unpaid accounts on the
// money page, an advertiser getting nothing out of their spot nowhere at all.
// This module inverts that and returns the answers as a ranked list:
//
//   1. Are the screens working?
//   2. Is anyone paying us less than they should, or not at all?
//   3. Is an advertiser we already have failing to get results?
//   4. What are we giving away for free, and what does it cost?
//
// Every case carries a dollar figure, an age, and a link into a page that shows
// the evidence behind it. Nothing here is advisory: if a case is open, something
// is wrong.
//
// WHAT IS NOT A CASE, and why the list got readable when they left:
//
//   * Open inventory. Every venue is mostly unsold and the number is four
//     figures, so sorting by money put "19 of 24 spots open" above a screen that
//     had been dark three days. Selling is a job, not an exception — /admin/sell.
//   * Hosts owed their free screens. Nothing is broken; someone has to ring them.
//     It is a call, and it belongs on the call list with their phone number
//     attached — lib/callList.ts.
//   * One outage, once. A dark screen used to appear as itself AND again for
//     every advertiser sitting on it. See the collapse in the under-delivery
//     block: four outages made eleven rows, and now make five.
//
// The numbers stay honest about their provenance, the same way lib/analytics.ts
// does: plays and scans are MEASURED, reach is ESTIMATED and always labeled.
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { screenDownState } from '@/lib/uptime'
import { loadAdminInbox, loadBillingRows } from '@/lib/adminInbox'
import { loadInventory } from '@/lib/inventory'
import { loadHostBenefits, discretionaryFreeScreens } from '@/lib/hostBenefit'
import { formatCents } from '@/lib/format'
import { loadDismissals, stillDismissed, type Dismissal } from '@/lib/caseDismissals'
import type { VenueHours } from '@/lib/openHours'

// The columns every "is this screen actually down" check needs. Kept in one
// place so the board and the case pages ask the same question of the same data.
const HOURS_COLUMNS = 'business_open, business_close, business_days, business_hours'

import type { Case } from '@/lib/caseTypes'

export type { Case, CaseKind, Severity } from '@/lib/caseTypes'
export { SEVERITY_RANK, SEVERITY_LABEL } from '@/lib/caseTypes'

// An advertiser has to have been on screen enough for a zero to mean anything.
// Below this a low scan count is noise, not a verdict.
const MIN_PLAYS_FOR_VERDICT = 300
// Their scan rate has to be this far under the network median before we call it
// a results problem rather than ordinary variation.
const UNDERPERFORM_RATIO = 0.4
const WINDOW_DAYS = 30

const windowStartISO = () => new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

/** "Archie's, Brassa and Twin Ravens" — names, not a count you cannot act on. */
function listNames(names: string[], max = 3): string {
  if (names.length === 1) return names[0]
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

// ---------------------------------------------------------------------------
// Per-advertiser results — the part that did not exist before.
// ---------------------------------------------------------------------------

export interface AdResults {
  campaignId: string
  advertiserId: string
  advertiserName: string
  adId: string
  adTitle: string
  monthlyCents: number
  /** MEASURED proof-of-play over the window. */
  plays: number
  /** MEASURED QR scans over the window, bots excluded. */
  scans: number
  /** Scans per 1,000 plays — the one rate that compares two advertisers fairly. */
  scanRate: number | null
  screens: number
  darkScreens: number
  /**
   * WHICH screens are dark, not just how many. The board needs the identities to
   * tell "this advertiser is suffering an outage already on the list" from "this
   * advertiser is suffering an outage nothing else would show you" — the first
   * is a duplicate of a screen case, the second is the only place it surfaces.
   */
  darkTvIds: string[]
  /** ESTIMATED humans reached: venue foot traffic, never presented as measured. */
  estReach: number
  venueNames: string[]
}

type PlacementRow = {
  ad_id: string
  campaign_id: string | null
  tv: { id: string; last_heartbeat_at: string | null; venue_id: string } | null
}

// Count rows without pulling them back. ad_plays is append-only and grows by
// thousands per screen per day, so the board can never afford to fetch it —
// but an indexed count(*) per ad is cheap and exact.
//
// Counted with the ADMIN client, scoped to ad ids we have already resolved, for
// the reason app/host/page.tsx documents: per-table RLS makes aggregate reads
// unreliable, and an exact count over a table this size is where that shows.
// It failed silently and asymmetrically — the three advertisers with the MOST
// plays (12k, 28k, 36k) all read as zero while smaller counts came back fine,
// so the roster reported "not shown once" for the accounts running the most.
// A zero here is not cosmetic: diagnose() reads it as too-new and drops them out
// of the results cases entirely. Every caller is already behind requireAdmin().
// Cached across requests, not just within one. React's cache() dedupes inside a
// single render, but this same count was being recomputed on every navigation —
// and it is the most expensive query in the admin, run once per ad, on every
// page that shows a verdict or a problem count. A 30-day total does not
// meaningfully change minute to minute, so serving a slightly stale one is the
// right trade for a page that opens immediately. Safe to cache because it takes
// no cookies: it runs on the admin client, and callers are behind requireAdmin.
const cachedPlayCount = unstable_cache(
  async (adId: string, sinceISO: string): Promise<number> => {
    const { count, error } = await createAdminClient()
      .from('ad_plays')
      .select('*', { count: 'exact', head: true })
      .eq('ad_id', adId)
      .gte('played_at', sinceISO)
    if (error) {
      // Never let a failed count masquerade as a measured zero.
      console.error('ad_plays count failed for', adId, error.message)
      return 0
    }
    return count ?? 0
  },
  ['ad-plays-30d'],
  { revalidate: 300 }
)

// The window start moves every millisecond, which would make the cache key
// unique per request and cache nothing at all. Round it down to the hour so
// every request in that hour shares a key, and the value stays a real timestamp
// Postgres can compare against.
function countPlays(adId: string, sinceISO: string): Promise<number> {
  const hour = new Date(sinceISO)
  hour.setUTCMinutes(0, 0, 0)
  return cachedPlayCount(adId, hour.toISOString())
}

/**
 * Delivery and response for every campaign that is actually running, over the
 * last 30 days. This is the data behind "are they getting results" — and the
 * only place in the app that compares one advertiser against the network.
 */
export const loadAdResults = cache(async (territoryId: string | null): Promise<AdResults[]> => {
  const supabase = await createClient()
  const billing = await loadBillingRows(territoryId)
  if (!billing.length) return []

  const campaignIds = billing.map((b) => b.campaignId)
  const sinceISO = windowStartISO()

  // Where each campaign is running right now, and whether those screens are alive.
  const { data: placeData } = await supabase
    .from('ad_placements')
    .select('ad_id, campaign_id, tv:tvs(id, last_heartbeat_at, venue_id)')
    .eq('status', 'active')
    .in('campaign_id', campaignIds)
  const placements = ((placeData ?? []) as unknown as PlacementRow[]).filter((p) => p.tv)

  const venueIds = [...new Set(placements.map((p) => p.tv!.venue_id))]
  const venueById = new Map<string, { name: string; reach: number; hours: VenueHours }>()
  if (venueIds.length) {
    const { data: vs } = await supabase
      .from('venues')
      .select(`id, name, foot_traffic_estimate, median_daily_customers, ${HOURS_COLUMNS}`)
      .in('id', venueIds)
    for (const v of (vs ?? []) as unknown as ({
      id: string
      name: string
      foot_traffic_estimate: number | null
      median_daily_customers: number | null
    } & VenueHours)[]) {
      // Same estimate the advertiser's own report uses, so the two agree: a
      // host-stated daily count when we have one, else the monthly figure.
      const reach =
        v.median_daily_customers && v.median_daily_customers > 0
          ? v.median_daily_customers * 30
          : (v.foot_traffic_estimate ?? 0)
      venueById.set(v.id, {
        name: v.name,
        reach,
        hours: {
          business_open: v.business_open,
          business_close: v.business_close,
          business_days: v.business_days,
          business_hours: v.business_hours,
        },
      })
    }
  }

  const byCampaign = new Map<string, PlacementRow[]>()
  for (const p of placements) {
    if (!p.campaign_id) continue
    const list = byCampaign.get(p.campaign_id) ?? []
    list.push(p)
    byCampaign.set(p.campaign_id, list)
  }

  // Scans are small enough to aggregate in memory; plays are not.
  const adIds = [...new Set(placements.map((p) => p.ad_id))]
  if (!adIds.length) return []
  const { data: scanData } = await createAdminClient()
    .from('qr_scans')
    .select('ad_id')
    .in('ad_id', adIds)
    .eq('is_bot', false)
    .gte('scanned_at', sinceISO)
  const scansByAd = new Map<string, number>()
  for (const s of (scanData ?? []) as { ad_id: string }[]) {
    scansByAd.set(s.ad_id, (scansByAd.get(s.ad_id) ?? 0) + 1)
  }

  const playCounts = await Promise.all(adIds.map((id) => countPlays(id, sinceISO)))
  const playsByAd = new Map(adIds.map((id, i) => [id, playCounts[i]]))

  // Down, not merely quiet — a venue that is simply closed right now is not an
  // advertiser being short-changed.
  const isDark = (p: PlacementRow) => {
    const hours = venueById.get(p.tv!.venue_id)?.hours
    return hours ? screenDownState(p.tv!.last_heartbeat_at, hours).down : false
  }

  const out: AdResults[] = []
  for (const row of billing) {
    const rows = byCampaign.get(row.campaignId) ?? []
    if (!rows.length) continue
    const adId = rows[0].ad_id
    const venues = [...new Set(rows.map((p) => p.tv!.venue_id))]
    const plays = playsByAd.get(adId) ?? 0
    const scans = scansByAd.get(adId) ?? 0
    const darkTvIds = rows.filter(isDark).map((p) => p.tv!.id)
    out.push({
      campaignId: row.campaignId,
      advertiserId: row.advertiserId,
      advertiserName: row.advertiserName,
      adId,
      adTitle: row.adTitle,
      monthlyCents: row.monthlyCents,
      plays,
      scans,
      scanRate: plays > 0 ? (scans / plays) * 1000 : null,
      screens: rows.length,
      darkScreens: darkTvIds.length,
      darkTvIds,
      estReach: venues.reduce((s, id) => s + (venueById.get(id)?.reach ?? 0), 0),
      venueNames: venues.map((id) => venueById.get(id)?.name ?? 'Unknown venue').sort(),
    })
  }
  return out
})

/**
 * The network's median scans per 1,000 plays, across advertisers with enough
 * plays to count. This is the bar an individual advertiser is measured against —
 * without it, "34 scans" is a number nobody can judge.
 */
export function networkScanRate(rows: AdResults[]): number | null {
  const rates = rows
    .filter((r) => r.plays >= MIN_PLAYS_FOR_VERDICT && r.scanRate != null)
    .map((r) => r.scanRate as number)
    .sort((a, b) => a - b)
  if (!rates.length) return null
  const mid = Math.floor(rates.length / 2)
  return rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2
}

/** Why this advertiser is failing, in the order the fix has to happen. */
export type Diagnosis = 'not-airing' | 'no-response' | 'too-new' | 'healthy'

export function diagnose(r: AdResults, median: number | null): Diagnosis {
  // Delivery first: no point blaming the creative for a screen that is off.
  if (r.darkScreens > 0) return 'not-airing'
  if (r.plays < MIN_PLAYS_FOR_VERDICT) return 'too-new'
  if (median != null && r.scanRate != null && r.scanRate < median * UNDERPERFORM_RATIO)
    return 'no-response'
  if (r.plays > 0 && r.scans === 0) return 'no-response'
  return 'healthy'
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** A case someone has waved off, carrying the dismissal that is hiding it. */
export type SnoozedCase = Case & { dismissal: Dismissal }

export interface CaseBoardData {
  /** What is actually open right now — dismissals already applied. */
  cases: Case[]
  /** Hidden, and why. Kept so "clear" is never the same as "gone". */
  snoozed: SnoozedCase[]
  totals: {
    atRiskCents: number
    compedCents: number
    unsoldCents: number
    critical: number
    open: number
    snoozed: number
  }
}

export const loadCases = cache(async (territoryId: string | null): Promise<CaseBoardData> => {
  const supabase = await createClient()
  const [inbox, inventory, billing, results, hostBenefits] = await Promise.all([
    loadAdminInbox(territoryId),
    loadInventory(territoryId),
    loadBillingRows(territoryId),
    loadAdResults(territoryId),
    loadHostBenefits(territoryId),
  ])
  const benefitByHost = new Map(hostBenefits.map((b) => [b.hostId, b]))
  const median = networkScanRate(results)
  const cases: Case[] = []

  // ---- Screens that have gone dark -----------------------------------------
  // Money at risk is the revenue riding on that screen: each campaign running
  // there contributes its monthly rate spread across the screens it sits on, so
  // one dark screen out of five costs a fifth of that campaign, not all of it.
  const revenuePerTv = new Map<string, number>()
  const { data: tvData } = await supabase
    .from('tvs')
    .select(
      `id, device_id, last_heartbeat_at, venue:venues(id, name, status, territory_id, is_demo, ${HOURS_COLUMNS})`
    )
  type TvRow = {
    id: string
    device_id: string | null
    last_heartbeat_at: string | null
    venue:
      | ({ id: string; name: string; status: string; territory_id: string; is_demo: boolean } & VenueHours)
      | null
  }
  const tvs = ((tvData ?? []) as unknown as TvRow[])
    .map((tv) => ({ ...tv, venue: Array.isArray(tv.venue) ? tv.venue[0] : tv.venue }))
    .filter((tv) => tv.venue && !tv.venue.is_demo)
    .filter((tv) => !territoryId || tv.venue!.territory_id === territoryId)

  // Per-screen revenue share, derived from live placements.
  const { data: placeData } = await supabase
    .from('ad_placements')
    .select('campaign_id, tv_id')
    .eq('status', 'active')
  const tvsByCampaign = new Map<string, string[]>()
  for (const p of (placeData ?? []) as { campaign_id: string | null; tv_id: string }[]) {
    if (!p.campaign_id) continue
    const list = tvsByCampaign.get(p.campaign_id) ?? []
    list.push(p.tv_id)
    tvsByCampaign.set(p.campaign_id, list)
  }
  const monthlyByCampaign = new Map(billing.map((b) => [b.campaignId, b.monthlyCents]))
  for (const [campaignId, tvIds] of tvsByCampaign) {
    const monthly = monthlyByCampaign.get(campaignId) ?? 0
    if (!monthly || !tvIds.length) continue
    const share = Math.round(monthly / tvIds.length)
    for (const tvId of tvIds) revenuePerTv.set(tvId, (revenuePerTv.get(tvId) ?? 0) + share)
  }

  // Who is going without, per screen. The board used to print a bare count
  // ("5 advertisers not airing here"), which is the one detail you cannot act
  // on — whether to drive out there tonight depends entirely on WHICH five.
  const affectedByTv = new Map<string, string[]>()
  for (const r of results) {
    for (const tvId of r.darkTvIds) {
      const list = affectedByTv.get(tvId) ?? []
      list.push(r.advertiserName)
      affectedByTv.set(tvId, list)
    }
  }

  // Screens whose outage is on this board under its own case. An advertiser
  // whose only problem is one of these is not a second problem — see the
  // under-delivery block below.
  const boardedDarkTvs = new Set<string>()

  for (const tv of tvs) {
    // An unpaired screen is an install that has not happened, not an outage —
    // that belongs in the pipeline, not on the broken list.
    if (!tv.device_id || tv.venue!.status !== 'active') continue
    const state = screenDownState(tv.last_heartbeat_at, tv.venue!)
    if (!state.down) continue
    boardedDarkTvs.add(tv.id)
    const money = revenuePerTv.get(tv.id) ?? 0
    const names = [...new Set(affectedByTv.get(tv.id) ?? [])].sort()
    const cause =
      state.reason === 'never-checked-in'
        ? 'Paired but has never checked in'
        : state.reason === 'down-over-a-day'
          ? 'Has not checked in for over a day'
          : 'Stopped checking in while the venue is open'
    cases.push({
      id: `screen-dark:${tv.id}`,
      kind: 'screen-dark',
      severity: 'critical',
      title: tv.venue!.name,
      summary: names.length
        ? `${cause} — ${listNames(names)} not airing here`
        : `${cause} — nothing is playing`,
      moneyCents: money,
      moneyNote: money ? 'riding on this screen' : 'no ads sold here yet',
      since: tv.last_heartbeat_at,
      href: `/admin/cases/screen-dark/${tv.id}`,
      subjectId: tv.id,
    })
  }

  // ---- Advertisers who are not getting what they paid for -------------------
  // A comped account still deserves the case — they are still not getting what
  // they were promised — but their rate is NOT revenue at risk, because it was
  // never revenue. Rolling comps into "at risk" would make the headline number
  // describe money the business has no claim on.
  const methodByCampaign = new Map(billing.map((b) => [b.campaignId, b.billing.method]))
  const isFree = (id: string) => {
    const m = methodByCampaign.get(id)
    return m === 'comp' || m === 'unbilled'
  }

  // Delivery money that no screen case is already carrying. See the atRisk
  // calculation at the bottom: a dark screen's case counts the revenue riding on
  // that screen, so counting the advertiser's full monthly rate on top of it
  // billed the same outage twice and inflated the headline number.
  let uncoveredDeliveryCents = 0

  for (const r of results) {
    const d = diagnose(r, median)
    if (d === 'healthy' || d === 'too-new') continue
    const free = isFree(r.campaignId)
    if (d === 'not-airing') {
      // THE COLLAPSE. An advertiser is "not airing" because screens they sit on
      // are dark. Those screens are already cases, and each one names the
      // advertisers going without — so emitting a row per advertiser restates a
      // problem the board is already showing, once per victim. Four dark screens
      // were producing four screen cases plus seven advertiser cases: eleven
      // rows, one job.
      const covered = r.darkTvIds.every((id) => boardedDarkTvs.has(id))
      // One exception, and it is not a duplicate: a PAYING advertiser with
      // nothing at all on screen. "A screen is down" is a repair. "This customer
      // is receiving nothing for their money" is a credit, a move, or a phone
      // call before they churn — a different job, on a different clock, that no
      // screen case would ever put in front of you.
      const blackout = r.darkScreens === r.screens && !free
      if (covered && !blackout) continue

      // Only the part no screen case is carrying, so the totals stay exact.
      const uncovered = r.darkTvIds.filter((id) => !boardedDarkTvs.has(id)).length
      if (!free) {
        uncoveredDeliveryCents += Math.round((r.monthlyCents * uncovered) / Math.max(1, r.screens))
      }

      cases.push({
        id: `under-delivery:${r.campaignId}`,
        kind: 'under-delivery',
        severity: free ? 'warning' : 'critical',
        title: r.advertiserName,
        summary: blackout
          ? `Paying ${formatCents(r.monthlyCents)} a month and not one of their ${r.screens} screen${r.screens === 1 ? ' is' : 's are'} airing — they are getting nothing`
          : `${free ? 'Running free on' : 'Paying for'} ${r.screens} screen${r.screens === 1 ? '' : 's'}, ${r.darkScreens} of them not airing — they are not getting what they were promised`,
        moneyCents: r.monthlyCents,
        moneyNote: blackout
          ? 'paying for nothing at all'
          : free
            ? 'comped value not delivered'
            : 'paid for delivery we are not making',
        since: null,
        href: `/admin/cases/under-delivery/${r.campaignId}`,
        subjectId: r.campaignId,
      })
      continue
    }
    cases.push({
      id: `no-results:${r.campaignId}`,
      kind: 'no-results',
      severity: 'warning',
      title: r.advertiserName,
      summary:
        r.scans === 0
          ? `Shown ${r.plays.toLocaleString()} times in 30 days and not one scan`
          : `${r.scanRate!.toFixed(1)} scans per 1,000 plays against a network median of ${median!.toFixed(1)}`,
      moneyCents: r.monthlyCents,
      moneyNote: free ? 'comped — nothing to renew yet' : 'will not renew without results',
      since: null,
      href: `/admin/cases/no-results/${r.campaignId}`,
      subjectId: r.campaignId,
    })
  }

  // ---- Ads still airing for a campaign that ended ---------------------------
  // Cancelling a campaign does not reliably pull its ad off the screens. Those
  // placements keep playing and keep occupying a sellable spot, so the loss is
  // twice: delivery for someone who left, and inventory you cannot sell to
  // anyone who would pay for it.
  {
    const { data: ghostRows } = await supabase
      .from('ad_placements')
      .select(
        'tv_id, ad:ads(title), campaign:campaigns(id, status, deleted_at, monthly_total_cents, advertiser:profiles!advertiser_id(id, full_name, email))'
      )
      .eq('status', 'active')
      .not('campaign_id', 'is', null)
    type GhostRow = {
      tv_id: string
      ad: { title: string } | { title: string }[] | null
      campaign:
        | {
            id: string
            status: string
            deleted_at: string | null
            monthly_total_cents: number | null
            advertiser: { id: string; full_name: string | null; email: string } | { id: string; full_name: string | null; email: string }[] | null
          }
        | null
    }
    const pick = <T,>(v: T | T[] | null | undefined): T | null =>
      Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

    const byCampaign = new Map<
      string,
      { name: string; adTitle: string; screens: number; monthly: number; status: string }
    >()
    for (const raw of (ghostRows ?? []) as unknown as GhostRow[]) {
      const c = pick(raw.campaign)
      if (!c) continue
      const dead = !!c.deleted_at || (c.status !== 'active' && c.status !== 'paused')
      if (!dead) continue
      const adv = pick(c.advertiser)
      const cur = byCampaign.get(c.id) ?? {
        name: adv?.full_name ?? adv?.email ?? 'Unknown advertiser',
        adTitle: pick(raw.ad)?.title ?? 'Their ad',
        screens: 0,
        monthly: c.monthly_total_cents ?? 0,
        status: c.deleted_at ? 'deleted' : c.status,
      }
      cur.screens++
      byCampaign.set(c.id, cur)
    }

    for (const [campaignId, g] of byCampaign) {
      cases.push({
        id: `airing-after-cancel:${campaignId}`,
        kind: 'airing-after-cancel',
        severity: 'critical',
        title: g.name,
        summary: `"${g.adTitle}" is still on ${g.screens} screen${g.screens === 1 ? '' : 's'} after the campaign was ${g.status} — airing free and holding spots you could sell`,
        moneyCents: g.monthly,
        moneyNote: 'was paying, still airing',
        since: null,
        href: `/admin/cases/airing-after-cancel/${campaignId}`,
        subjectId: campaignId,
      })
    }
  }

  // ---- Hosts we owe are a CALL, not a breakage --------------------------
  // Two free advertising screens for every screen a host gives us. It was going
  // undelivered silently — the perk is a Stripe code minted when the venue goes
  // live, and nothing ever checked whether the host redeemed it — so surfacing
  // it was right. Putting it HERE was not.
  //
  // Nothing is broken and no money is at risk; someone has to ring a host and
  // walk them through taking up what they already earned. That is the call list
  // (lib/callList.ts, reason 'owed'), where the row arrives with their phone
  // number on it instead of a link to a page about them. Five hosts were sitting
  // at the bottom of this board at $0 apiece, permanently, which is how a board
  // teaches you to skip its last five rows.

  // ---- What we are giving away ---------------------------------------------
  // A comp is a decision, not an accident — but an untracked comp is how a
  // network runs at capacity and still makes nothing.
  //
  // A HOST's free screens are not that. They are what we owe for the screen in
  // their room, so only the part above their allowance is discretionary. Calling
  // the whole thing a giveaway would put every host on this list for taking the
  // deal we sold them.
  // A host over their allowance is ONE conversation, however many comped
  // campaigns it is spread across. Iterating billing rows put the same host on
  // the board once per campaign, with byte-identical summaries — the benefit
  // figures describe the host, not the campaign, so the rows could not even be
  // told apart. Collected by host first, emitted once below.
  const overHosts = new Map<
    string,
    { name: string; benefit: NonNullable<ReturnType<typeof benefitByHost.get>>; cents: number; campaignId: string; topCents: number; since: string | null }
  >()

  for (const row of billing) {
    if (row.billing.method !== 'comp' && row.billing.method !== 'unbilled') continue
    const res = results.find((r) => r.campaignId === row.campaignId)
    const benefit = benefitByHost.get(row.advertiserId)
    if (benefit) {
      // Entirely covered by the hosting agreement — nothing to convert.
      if (discretionaryFreeScreens(benefit) === 0) continue
      const cur = overHosts.get(row.advertiserId)
      if (!cur) {
        overHosts.set(row.advertiserId, {
          name: row.advertiserName,
          benefit,
          cents: row.monthlyCents,
          // Link at their biggest comped campaign — the one worth acting on.
          campaignId: row.campaignId,
          topCents: row.monthlyCents,
          since: row.billing.paidThrough ?? null,
        })
      } else {
        cur.cents += row.monthlyCents
        if (row.monthlyCents > cur.topCents) {
          cur.topCents = row.monthlyCents
          cur.campaignId = row.campaignId
        }
        cur.since = cur.since ?? row.billing.paidThrough ?? null
      }
      continue
    }
    cases.push({
      id: `free-rider:${row.campaignId}`,
      kind: 'free-rider',
      severity: row.billing.method === 'unbilled' ? 'warning' : 'opening',
      title: row.advertiserName,
      summary:
        row.billing.method === 'unbilled'
          ? `On screens with nothing set up to bill them — ${row.billing.summary}`
          : `Comped — ${row.billing.summary}${res ? ` · ${res.plays.toLocaleString()} plays delivered` : ''}`,
      moneyCents: row.monthlyCents,
      moneyNote: row.billing.method === 'comp' ? 'given away each month' : 'running unbilled',
      since: row.billing.paidThrough ?? null,
      href: `/admin/cases/free-rider/${row.campaignId}`,
      subjectId: row.campaignId,
    })
  }

  // One row per over-allowance host. Keyed on the host, not the campaign, so
  // re-dismissing does not have to be done once per campaign either.
  for (const [hostId, h] of overHosts) {
    const extra = discretionaryFreeScreens(h.benefit)
    cases.push({
      id: `free-rider:host:${hostId}`,
      kind: 'free-rider',
      severity: 'opening',
      title: h.name,
      summary: `Host of ${listNames(h.benefit.venueNames)} — running ${h.benefit.using} free screens, ${extra} more than hosting ${h.benefit.hostedTvs} screen${h.benefit.hostedTvs === 1 ? '' : 's'} earns`,
      moneyCents: h.cents,
      moneyNote: 'above the hosting deal',
      since: h.since,
      href: `/admin/cases/free-rider/${h.campaignId}`,
      subjectId: h.campaignId,
    })
  }

  // ---- Money that should already be in the bank -----------------------------
  for (const row of billing) {
    if (row.billing.health !== 'overdue' && row.billing.health !== 'due') continue
    // An expiring comp is already on the board as what we are giving away;
    // listing it twice would double-count the same dollars.
    if (row.billing.method === 'comp') continue
    cases.push({
      id: `money-overdue:${row.campaignId}`,
      kind: 'money-overdue',
      severity: row.billing.health === 'overdue' ? 'critical' : 'warning',
      title: row.advertiserName,
      summary: `${row.adTitle} · ${row.billing.summary}`,
      moneyCents: row.monthlyCents,
      moneyNote: row.billing.health === 'overdue' ? 'overdue' : 'due soon',
      since: row.billing.paidThrough ?? null,
      href: `/admin/cases/money-overdue/${row.campaignId}`,
      subjectId: row.campaignId,
    })
  }

  // ---- Empty slots are NOT cases -------------------------------------------
  // Open inventory used to be one row per venue, and those rows owned the top of
  // the board: every venue is mostly unsold, the number is four figures, and the
  // list sorts by money — so "19 of 24 spots open" outranked a screen that had
  // been dark for three days. It is also not a problem you fix today by clicking
  // it. Selling is its own job with its own surface (/admin/sell), and it is the
  // whole job, not an exception to a working state.
  //
  // The dollar total still belongs here, because "what is unsold" is one of the
  // four numbers above the board — it just does not belong IN the board.
  const unsoldCents = inventory.rows
    .filter((v) => v.active && v.open > 0 && v.liveScreens > 0)
    .reduce((s, v) => s + v.openValueCents, 0)

  // ---- Everything else waiting on a human ----------------------------------
  // These already had a home that works; they join the board so one list really
  // is the whole list, and link straight back out to the page that handles them.
  for (const item of inbox.items) {
    if (item.kind === 'billing' || item.kind === 'offline') continue
    cases.push({
      id: `task:${item.kind}:${item.href}:${item.title}`,
      kind: 'task',
      severity: 'task',
      title: item.title,
      summary: item.detail,
      moneyCents: 0,
      moneyNote: '',
      since: item.at ?? null,
      href: item.href,
      subjectId: item.href,
    })
  }

  // "At risk" means revenue the business could actually lose. A screen going dark
  // under a comped ad costs nothing this month; it is on the board because it is
  // broken, not because it is billable.
  //
  // Delivery money is counted ONCE, on the screen. It used to be counted twice:
  // each dark screen contributed the revenue riding on it, AND every advertiser
  // on that screen contributed their full monthly rate. With four screens dark
  // the headline read $932 when the honest figure was $544 — the same outage,
  // billed once per screen and again per victim. Only delivery on screens that
  // have no case of their own (uncoveredDeliveryCents) is added back here.
  const atRiskCents =
    uncoveredDeliveryCents +
    cases
      .filter(
        (c) =>
          c.kind === 'screen-dark' ||
          c.kind === 'money-overdue' ||
          // Not counted: an ad airing after cancellation is inventory leaking,
          // not revenue we still have a claim on.
          (c.kind === 'no-results' && !isFree(c.subjectId))
      )
      .reduce((s, c) => s + c.moneyCents, 0)
  const compedCents = cases.filter((c) => c.kind === 'free-rider').reduce((s, c) => s + c.moneyCents, 0)

  // ---- What has been waved off ---------------------------------------------
  // Applied last, so every rule above stays ignorant of dismissals and the
  // totals describe the real state of the business rather than the state of the
  // list. A snoozed dark screen still costs what it costs.
  const dismissals = await loadDismissals()
  const now = Date.now()
  const open: Case[] = []
  const snoozed: SnoozedCase[] = []
  for (const c of cases) {
    const d = dismissals.get(c.id)
    if (d && stillDismissed(c, d, now)) snoozed.push({ ...c, dismissal: d })
    else open.push(c)
  }

  return {
    cases: open,
    snoozed,
    totals: {
      atRiskCents,
      compedCents,
      unsoldCents,
      critical: open.filter((c) => c.severity === 'critical').length,
      open: open.length,
      snoozed: snoozed.length,
    },
  }
})
