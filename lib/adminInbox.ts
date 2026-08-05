// The admin inbox — everything waiting on a human, in one list.
//
// The old overview answered "how is the network doing". That is the wrong first
// question for a network this size: with a handful of screens the operator
// already knows the shape of the business, and what they actually need on
// opening /admin is the short list of things that will not move unless they do
// something today.
//
// One module builds that list so the Today page and the sidebar badges can never
// disagree about how many things are waiting.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { isTvLive } from '@/lib/format'
import { resolveBilling, billingAction, type BillingState } from '@/lib/billing'
import { getSetting } from '@/lib/settings.server'
import { loadDueFollowUps } from '@/lib/opportunities'

export type InboxKind =
  | 'approval'
  | 'billing'
  | 'activation'
  | 'followup'
  | 'offline'
  | 'creative'

export interface InboxItem {
  kind: InboxKind
  // Sorts the whole list. 0 = do this first.
  rank: number
  title: string
  detail: string
  href: string
  // Right-aligned nudge ("Record payment", "Review"), never a full sentence.
  cta: string
  at?: string | null
}

export interface AdminInbox {
  items: InboxItem[]
  counts: {
    approvals: number
    creative: number
    billing: number
    activation: number
    followup: number
    offline: number
    total: number
  }
}

// Ranked worst-first: money that was sold but never billed, then money taken for
// something not yet on screen, then a follow-up you promised, then an ad waiting
// on review, then a dark screen, then a creative request.
//
// Follow-ups sit above approvals because a promised call that does not happen is
// how a deal quietly dies, and nothing else in this app will ever surface it.
const RANK: Record<InboxKind, number> = {
  billing: 0,
  activation: 1,
  followup: 2,
  approval: 3,
  offline: 4,
  creative: 5,
}

type CampaignRow = {
  id: string
  advertiser_id: string
  status: string
  comp_until: string | null
  monthly_total_cents: number | null
  is_demo: boolean
  ad: { title: string } | { title: string }[] | null
  advertiser: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

// Every live campaign with its derived billing state, newest money problem first.
// Exported because the Money page renders the same rows in full.
export interface BillingRow {
  campaignId: string
  advertiserId: string
  advertiserName: string
  adTitle: string
  monthlyCents: number
  billing: BillingState
}

// cache() so the layout's sidebar badge and the page body share ONE round trip
// per request instead of each re-running the whole billing rollup.
export const loadBillingRows = cache(async (territoryId: string | null): Promise<BillingRow[]> => {
  const supabase = await createClient()

  let cq = supabase
    .from('campaigns')
    .select(
      'id, advertiser_id, status, comp_until, monthly_total_cents, is_demo, ad:ads(title), advertiser:profiles!advertiser_id(full_name, email)'
    )
    .in('status', ['active', 'paused'])
  if (territoryId) cq = cq.eq('territory_id', territoryId)
  const { data: campData } = await cq
  const campaigns = ((campData ?? []) as unknown as CampaignRow[]).filter((c) => !c.is_demo)
  if (!campaigns.length) return []

  const ids = campaigns.map((c) => c.id)
  const [{ data: subData }, { data: payData }] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('campaign_id, status, stripe_subscription_id, current_period_end')
      .in('campaign_id', ids),
    supabase.from('payments').select('campaign_id, paid_at').in('campaign_id', ids),
  ])

  const subByCampaign = new Map<
    string,
    { status: string; stripe_subscription_id: string | null; current_period_end: string | null }
  >()
  for (const s of (subData ?? []) as {
    campaign_id: string | null
    status: string
    stripe_subscription_id: string | null
    current_period_end: string | null
  }[]) {
    if (s.campaign_id && !subByCampaign.has(s.campaign_id)) subByCampaign.set(s.campaign_id, s)
  }

  // Most recent payment per campaign — the anchor for a check-paid account's
  // paid-through date when nobody set one explicitly.
  const lastPaidByCampaign = new Map<string, string>()
  for (const p of (payData ?? []) as { campaign_id: string | null; paid_at: string }[]) {
    if (!p.campaign_id) continue
    const prev = lastPaidByCampaign.get(p.campaign_id)
    if (!prev || p.paid_at > prev) lastPaidByCampaign.set(p.campaign_id, p.paid_at)
  }

  // The "due soon" threshold is admin-editable, so read it rather than assuming
  // the coded default.
  const dueSoonDays = await getSetting('due_soon_days')
  const now = Date.now()

  return campaigns
    .map((c) => {
      const sub = subByCampaign.get(c.id)
      const adv = one(c.advertiser)
      return {
        campaignId: c.id,
        advertiserId: c.advertiser_id,
        advertiserName: adv?.full_name ?? adv?.email ?? 'Unknown',
        adTitle: one(c.ad)?.title ?? 'Untitled ad',
        monthlyCents: c.monthly_total_cents ?? 0,
        billing: resolveBilling(
          {
            campaignStatus: c.status,
            compUntil: c.comp_until,
            stripeSubscriptionId: sub?.stripe_subscription_id ?? null,
            subscriptionStatus: sub?.status ?? null,
            currentPeriodEnd: sub?.current_period_end ?? null,
            lastPaidAt: lastPaidByCampaign.get(c.id) ?? null,
          },
          now,
          dueSoonDays
        ),
      }
    })
    .sort((a, b) => {
      // Worst health first, then soonest paid-through.
      const order = { unbilled: 0, overdue: 1, due: 2, ok: 3 }
      const d = order[a.billing.health] - order[b.billing.health]
      if (d !== 0) return d
      return (a.billing.daysLeft ?? 9e9) - (b.billing.daysLeft ?? 9e9)
    })
})

export const loadAdminInbox = cache(async (territoryId: string | null): Promise<AdminInbox> => {
  const supabase = await createClient()
  const t = territoryId

  // Screens in scope, resolved through their venue's territory.
  let venueIds: string[] | null = null
  if (t) {
    const { data } = await supabase.from('venues').select('id').eq('territory_id', t).eq('is_demo', false)
    venueIds = (data ?? []).map((v) => v.id)
  }

  let pendingQ = supabase
    .from('ads')
    .select('id, title, created_at, owner_user_id, is_demo')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (t) pendingQ = pendingQ.eq('territory_id', t)

  let tvQ = supabase.from('tvs').select('id, device_id, last_heartbeat_at, venue:venues(name, status)')
  if (venueIds) tvQ = tvQ.in('venue_id', venueIds.length ? venueIds : ['00000000-0000-0000-0000-000000000000'])

  let draftPaidQ = supabase
    .from('subscriptions')
    .select('id, campaign_id, campaign:campaigns(id, status, is_demo, ad:ads(title))')
    .in('status', ['active', 'past_due'])
  if (t) draftPaidQ = draftPaidQ.eq('territory_id', t)

  const [pendingRes, creativeRes, tvRes, draftPaidRes, billingRows, dueFollowUps] = await Promise.all([
    pendingQ,
    supabase
      .from('creative_requests')
      .select('id, brief, created_at', { count: 'exact' })
      .neq('status', 'done')
      .order('created_at', { ascending: true }),
    tvQ,
    draftPaidQ,
    loadBillingRows(t),
    // Returns [] when the pipeline tables do not exist yet, so Today keeps
    // working exactly as before until migration 0068 is applied.
    loadDueFollowUps(t),
  ])

  const items: InboxItem[] = []

  // ---- Money first ----
  for (const row of billingRows) {
    const cta = billingAction(row.billing)
    if (!cta) continue
    items.push({
      kind: 'billing',
      rank: RANK.billing,
      title: row.advertiserName,
      detail: `${row.adTitle} · ${row.billing.summary}`,
      href: `/admin/money?campaign=${row.campaignId}`,
      cta,
    })
  }

  // ---- Paid but never activated (the Stripe webhook never landed) ----
  const stuck = ((draftPaidRes.data ?? []) as unknown as {
    campaign: { id: string; status: string; is_demo: boolean; ad: { title: string } | null } | null
  }[])
    .map((s) => (Array.isArray(s.campaign) ? s.campaign[0] : s.campaign))
    .filter((c) => c && c.status === 'draft' && !c.is_demo)
  for (const c of stuck) {
    if (!c) continue
    const ad = Array.isArray(c.ad) ? c.ad[0] : c.ad
    items.push({
      kind: 'activation',
      rank: RANK.activation,
      title: ad?.title ?? 'Campaign',
      detail: 'Paid at checkout but still draft — nothing is on screen',
      href: '/admin/money',
      cta: 'Activate',
    })
  }

  // ---- Follow-ups you promised ----
  // The only item in this list that exists because YOU said you would do it,
  // rather than because a customer or a device did something.
  for (const f of dueFollowUps) {
    items.push({
      kind: 'followup',
      rank: RANK.followup,
      title: f.businessName,
      detail: f.nextStep
        ? `${f.overdue ? 'Overdue' : 'Due today'} · ${f.nextStep}`
        : `${f.overdue ? 'Overdue' : 'Due today'} · follow up`,
      href: `/admin/pipeline/${f.id}`,
      cta: f.overdue ? 'Overdue' : 'Follow up',
      at: f.nextStepAt,
    })
  }

  // ---- Ads waiting on review ----
  const pendingAds = ((pendingRes.data ?? []) as {
    id: string
    title: string
    created_at: string
    is_demo: boolean
  }[]).filter((a) => !a.is_demo)
  for (const ad of pendingAds) {
    items.push({
      kind: 'approval',
      rank: RANK.approval,
      title: ad.title,
      detail: 'Waiting on your review before it can air',
      href: '/admin/queue',
      cta: 'Review',
      at: ad.created_at,
    })
  }

  // ---- Screens that are paired but dark ----
  const darkTvs = ((tvRes.data ?? []) as unknown as {
    id: string
    device_id: string | null
    last_heartbeat_at: string | null
    venue: { name: string; status: string } | null
  }[]).filter((tv) => {
    const venue = Array.isArray(tv.venue) ? tv.venue[0] : tv.venue
    // Only paired screens at live venues: an unpaired screen is an install
    // that hasn't happened yet, not an outage.
    return !!tv.device_id && venue?.status === 'active' && !isTvLive(tv.last_heartbeat_at)
  })
  for (const tv of darkTvs) {
    const venue = Array.isArray(tv.venue) ? tv.venue[0] : tv.venue
    items.push({
      kind: 'offline',
      rank: RANK.offline,
      title: venue?.name ?? 'Screen',
      detail: 'Screen has stopped checking in — nothing is playing there',
      href: `/admin/tvs/${tv.id}`,
      cta: 'Open screen',
      at: tv.last_heartbeat_at,
    })
  }

  // ---- Creative the advertiser asked us to build ----
  const creativeReqs = (creativeRes.data ?? []) as { id: string; brief: string; created_at: string }[]
  for (const r of creativeReqs) {
    items.push({
      kind: 'creative',
      rank: RANK.creative,
      title: 'Creative request',
      detail: r.brief.slice(0, 90) || 'No brief given',
      href: '/admin/creative',
      cta: 'Open',
      at: r.created_at,
    })
  }

  items.sort((a, b) => a.rank - b.rank || (a.at ?? '').localeCompare(b.at ?? ''))

  const counts = {
    approvals: pendingAds.length,
    creative: creativeReqs.length,
    billing: items.filter((i) => i.kind === 'billing').length,
    activation: stuck.length,
    followup: dueFollowUps.length,
    offline: darkTvs.length,
    total: items.length,
  }

  return { items, counts }
})
