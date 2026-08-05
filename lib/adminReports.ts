// Admin reporting — the numbers behind /admin/reports.
//
// Shaped after the "opportunity overview" dashboards Jacob already reads in GHL:
// a KPI row where every figure is stated against the SAME window immediately
// before it, then trend, mix, attribution, and a funnel.
//
// Not to be confused with lib/reports.ts, which builds the monthly ROI report an
// individual ADVERTISER receives. This file is the operator's view of the whole
// network.
//
// Two honesty rules run through it, because at ~9 screens the data is small
// enough that a careless dashboard lies:
//   1. Every KPI carries its raw previous value, not just a percentage. "+300%"
//      off a base of 1 is noise, and here the base is often 1.
//   2. Comped campaigns are never counted as revenue. They get their own
//      category so the give-away stays visible instead of flattering MRR.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { loadInventory } from '@/lib/inventory'
import { loadBillingRows } from '@/lib/adminInbox'
import { getSetting } from '@/lib/settings.server'

export const RANGE_DAYS = [7, 30, 90, 365] as const
export type RangeDays = (typeof RANGE_DAYS)[number]
export const DEFAULT_RANGE = 30

export interface Compared {
  current: number
  previous: number
}

export interface Point {
  label: string
  value: number
  hint?: string
}

export interface AdminReportData {
  days: number
  timeZone: string
  kpis: {
    dealsStarted: Compared
    wentLive: Compared
    churned: Compared
    mrrAdded: Compared
    collected: Compared
    scans: Compared
  }
  mrrCents: number
  compedCents: number
  goalCents: number
  collectedByMonth: Point[]
  spotsByMonth: Point[]
  billingMix: { label: string; count: number; cents: number; slot: 1 | 2 | 3 }[]
  scansByVenue: Point[]
  scansByHour: Point[]
  // Several small funnels rather than one. A funnel's bars are only comparable
  // when every stage counts the SAME thing — locations, spots and accounts are
  // three different units, and putting them on one scale drew "198 spots" and
  // "9 locations" as identical full-width bars.
  funnels: { title: string; unit: string; stages: { label: string; value: number; note?: string }[] }[]
  /** True when almost nothing happened in range — the page says so rather than drawing flat charts. */
  sparse: boolean
}

const DAY_MS = 86_400_000
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Month bucket key. UTC — the buckets only have to be consistent with each other.
const monthKey = (iso: string) => iso.slice(0, 7)

function lastNMonths(n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = []
  const d = new Date()
  d.setUTCDate(1)
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d)
    m.setUTCMonth(m.getUTCMonth() - i)
    out.push({
      key: `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`,
      label: MONTH_LABEL[m.getUTCMonth()],
    })
  }
  return out
}

export const loadAdminReports = cache(
  async (territoryId: string | null, days: number = DEFAULT_RANGE): Promise<AdminReportData> => {
    const supabase = await createClient()
    const now = Date.now()
    const start = new Date(now - days * DAY_MS).toISOString()
    const prevStart = new Date(now - 2 * days * DAY_MS).toISOString()
    const yearAgo = new Date(now - 365 * DAY_MS).toISOString()

    // Hour-of-day is only meaningful in the market's own clock, so read the
    // territory's timezone rather than bucketing in UTC and mislabelling it.
    let timeZone = 'America/New_York'
    {
      let tq = supabase.from('territories').select('timezone').limit(1)
      if (territoryId) tq = tq.eq('id', territoryId)
      const { data } = await tq.maybeSingle()
      const tz = (data as { timezone: string | null } | null)?.timezone
      if (tz) timeZone = tz
    }

    // Screens in scope, so scans and placements are territory-filtered.
    const inventory = await loadInventory(territoryId)
    const tvIds = inventory.rows.flatMap((r) => r.screens.map((s) => s.id))
    const venueByTv = new Map<string, string>()
    for (const r of inventory.rows) for (const s of r.screens) venueByTv.set(s.id, r.name)
    const scopedTvIds = tvIds.length ? tvIds : ['00000000-0000-0000-0000-000000000000']

    let campQ = supabase
      .from('campaigns')
      .select('id, created_at, updated_at, status, comp_until, monthly_total_cents, is_demo')
    if (territoryId) campQ = campQ.eq('territory_id', territoryId)

    let payQ = supabase.from('payments').select('amount_cents, paid_at').gte('paid_at', yearAgo)
    if (territoryId) payQ = payQ.eq('territory_id', territoryId)

    const [campRes, payRes, scanRes, placeRes, billingRows] = await Promise.all([
      campQ,
      payQ,
      supabase
        .from('qr_scans')
        .select('scanned_at, tv_id')
        .eq('is_bot', false)
        .gte('scanned_at', prevStart)
        .in('tv_id', scopedTvIds),
      supabase
        .from('ad_placements')
        .select('created_at, tv_id')
        .gte('created_at', yearAgo)
        .in('tv_id', scopedTvIds),
      loadBillingRows(territoryId),
    ])

    type Camp = {
      created_at: string
      updated_at: string
      status: string
      comp_until: string | null
      monthly_total_cents: number | null
      is_demo: boolean
    }
    const campaigns = ((campRes.data ?? []) as Camp[]).filter((c) => !c.is_demo)

    const inRange = (iso: string) => iso >= start
    const inPrev = (iso: string) => iso >= prevStart && iso < start

    // ---- KPIs, each against the same-length window immediately before ----
    const started = campaigns.filter((c) => inRange(c.created_at)).length
    const startedPrev = campaigns.filter((c) => inPrev(c.created_at)).length

    const live = campaigns.filter((c) => c.status === 'active')
    const wentLive = live.filter((c) => inRange(c.created_at)).length
    const wentLivePrev = live.filter((c) => inPrev(c.created_at)).length

    // Churn is approximated by a campaign moving to canceled inside the window.
    // Cancelling is deliberately rare here (it wipes placement_snapshots and the
    // advertiser's report with it), so this UNDERCOUNTS quiet lapses — Money is
    // authoritative for accounts that simply stopped paying.
    const canceled = campaigns.filter((c) => c.status === 'canceled')
    const churned = canceled.filter((c) => inRange(c.updated_at)).length
    const churnedPrev = canceled.filter((c) => inPrev(c.updated_at)).length

    const paidCampaigns = live.filter((c) => !c.comp_until)
    const mrrAdded = paidCampaigns
      .filter((c) => inRange(c.created_at))
      .reduce((a, c) => a + (c.monthly_total_cents ?? 0), 0)
    const mrrAddedPrev = paidCampaigns
      .filter((c) => inPrev(c.created_at))
      .reduce((a, c) => a + (c.monthly_total_cents ?? 0), 0)

    const payments = (payRes.data ?? []) as { amount_cents: number; paid_at: string }[]
    const collected = payments
      .filter((p) => inRange(p.paid_at))
      .reduce((a, p) => a + (p.amount_cents ?? 0), 0)
    const collectedPrev = payments
      .filter((p) => inPrev(p.paid_at))
      .reduce((a, p) => a + (p.amount_cents ?? 0), 0)

    const scans = (scanRes.data ?? []) as { scanned_at: string; tv_id: string | null }[]
    const scansNow = scans.filter((s) => inRange(s.scanned_at))
    const scansPrev = scans.filter((s) => inPrev(s.scanned_at)).length

    // ---- Trend: 12 months ----
    const months = lastNMonths(12)
    const collectedByMonth: Point[] = months.map((m) => ({
      label: m.label,
      value: payments
        .filter((p) => monthKey(p.paid_at) === m.key)
        .reduce((a, p) => a + (p.amount_cents ?? 0), 0),
    }))

    const placements = (placeRes.data ?? []) as { created_at: string; tv_id: string }[]
    const spotsByMonth: Point[] = months.map((m) => ({
      label: m.label,
      value: placements.filter((p) => monthKey(p.created_at) === m.key).length,
      hint: 'spots placed',
    }))

    // ---- Mix: how live money actually arrives ----
    const mix = billingRows.reduce(
      (acc, r) => {
        const k =
          r.billing.method === 'comp'
            ? 'comp'
            : r.billing.method === 'unbilled'
              ? 'unbilled'
              : 'paying'
        acc[k].count += 1
        acc[k].cents += r.monthlyCents
        return acc
      },
      {
        paying: { count: 0, cents: 0 },
        comp: { count: 0, cents: 0 },
        unbilled: { count: 0, cents: 0 },
      }
    )
    const billingMix: AdminReportData['billingMix'] = [
      { label: 'Paying', count: mix.paying.count, cents: mix.paying.cents, slot: 3 },
      { label: 'Comped', count: mix.comp.count, cents: mix.comp.cents, slot: 1 },
      { label: 'Live but unbilled', count: mix.unbilled.count, cents: mix.unbilled.cents, slot: 2 },
    ]

    // ---- Attribution: where the scans come from ----
    const byVenue = new Map<string, number>()
    for (const s of scansNow) {
      const name = s.tv_id ? venueByTv.get(s.tv_id) : undefined
      if (!name) continue
      byVenue.set(name, (byVenue.get(name) ?? 0) + 1)
    }
    const scansByVenue: Point[] = [...byVenue.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)

    const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false })
    const hours = new Array(24).fill(0) as number[]
    for (const s of scansNow) {
      const h = Number(hourFmt.format(new Date(s.scanned_at)))
      if (Number.isFinite(h)) hours[h % 24] += 1
    }
    const scansByHour: Point[] = hours.map((value, h) => ({
      // Label every 6th column only; 24 labels on a strip this wide collide.
      label: h % 6 === 0 ? `${h}:00` : '',
      value,
      hint: `${h}:00–${(h + 1) % 24}:00`,
    }))

    // ---- Funnel: where inventory stops turning into money ----
    const withScreens = inventory.rows.filter((r) => r.active && r.screens.length > 0).length
    const withLiveScreen = inventory.rows.filter(
      (r) => r.active && r.screens.some((s) => s.live)
    ).length
    const noScreen = inventory.totals.venues - withScreens
    const notPaying = mix.comp.count + mix.unbilled.count
    const liveAccounts = mix.paying.count + notPaying

    const funnels: AdminReportData['funnels'] = [
      {
        title: 'Distribution',
        unit: 'locations',
        stages: [
          {
            label: 'Active locations',
            value: inventory.totals.venues,
            note: noScreen > 0 ? `${noScreen} have no screen installed` : undefined,
          },
          { label: 'Have a screen', value: withScreens },
          {
            label: 'Have a screen checking in',
            value: withLiveScreen,
            note:
              withScreens - withLiveScreen > 0
                ? `${withScreens - withLiveScreen} location(s) dark right now`
                : undefined,
          },
        ],
      },
      {
        title: 'Inventory',
        unit: 'ad spots',
        stages: [
          { label: 'Sellable spots', value: inventory.totals.slots },
          {
            label: 'Sold',
            value: inventory.totals.sold,
            note: `${inventory.totals.pctSold}% of the network · ${inventory.totals.open} still open`,
          },
        ],
      },
      {
        title: 'Accounts',
        unit: 'advertisers',
        stages: [
          { label: 'Live on screens', value: liveAccounts },
          {
            label: 'Actually paying',
            value: mix.paying.count,
            note: notPaying > 0 ? `${notPaying} live but producing nothing` : undefined,
          },
        ],
      },
    ]

    const mrrCents = billingRows
      .filter((r) => r.billing.method !== 'comp' && r.billing.method !== 'unbilled')
      .reduce((a, r) => a + r.monthlyCents, 0)

    return {
      days,
      timeZone,
      kpis: {
        dealsStarted: { current: started, previous: startedPrev },
        wentLive: { current: wentLive, previous: wentLivePrev },
        churned: { current: churned, previous: churnedPrev },
        mrrAdded: { current: mrrAdded, previous: mrrAddedPrev },
        collected: { current: collected, previous: collectedPrev },
        scans: { current: scansNow.length, previous: scansPrev },
      },
      mrrCents,
      compedCents: mix.comp.cents,
      goalCents: await getSetting('mrr_goal_cents'),
      collectedByMonth,
      spotsByMonth,
      billingMix,
      scansByVenue,
      scansByHour,
      funnels,
      // Below this the charts are shapes, not signal, and the page says so.
      sparse: scansNow.length < 10 && collected === 0 && started === 0,
    }
  }
)
