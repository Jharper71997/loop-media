import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import { summarizeUptime, venueBusinessHours, UPTIME_SLA, type UptimeDay } from '@/lib/uptime'
import {
  venuePriceCents,
  suggestTier,
  DEFAULT_PRICING_CONFIG,
  type PricingConfig,
  type PriceTier,
} from '@/lib/pricing'

// SLA uptime credits. For each screen currently running a paid ad, measure last
// month's uptime against the ~80% business-hours SLA; when a screen fell short,
// credit the advertiser the shortfall (prorated on the screen's monthly price) to
// their Stripe customer balance (applied to the next invoice) and log it.
//
// Credit = screen monthly price × (SLA − measured uptime) — i.e. the gap below the
// guaranteed 80% line. Idempotent: one credit per (tv, campaign, month).
//
// NOT registered in vercel.json on purpose — Hobby has a cron-count limit and a 5th
// daily cron can silently break deploys. Run it monthly by hand (or fold the call
// into the existing daily reports cron once the Vercel plan/cadence is confirmed):
//   curl -H "Authorization: Bearer $CRON_SECRET" ".../api/cron/sla-credits?dry=1"
export const dynamic = 'force-dynamic'

type Admin = ReturnType<typeof createAdminClient>

type VenueRow = {
  id: string
  price_tier: string | null
  price_cents_override: number | null
  foot_traffic_estimate: number
  business_open: string | null
  business_close: string | null
  business_days: number[] | null
  business_hours: Record<string, { open: string; close: string }> | null
}

async function readPricingConfig(admin: Admin): Promise<PricingConfig> {
  const { data } = await admin
    .from('pricing_config')
    .select(
      'local_price_cents, standard_price_cents, high_price_cents, premium_price_cents, min_monthly_cents, host_discount_pct, loyalty_12mo_discount_pct, max_discount_pct, exclusivity_price_cents'
    )
    .eq('id', 'default')
    .maybeSingle()
  if (!data) return DEFAULT_PRICING_CONFIG
  return {
    tierPriceCents: {
      local: data.local_price_cents,
      standard: data.standard_price_cents,
      high: data.high_price_cents,
      premium: data.premium_price_cents,
    },
    minMonthlyCents: data.min_monthly_cents,
    hostDiscount: Number(data.host_discount_pct),
    loyalty12moDiscount: Number(data.loyalty_12mo_discount_pct),
    maxDiscount: Number(data.max_discount_pct),
    exclusivityPriceCents:
      data.exclusivity_price_cents ?? DEFAULT_PRICING_CONFIG.exclusivityPriceCents,
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const admin = createAdminClient()

  // Prior calendar month window.
  const now = new Date()
  const firstOfThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const firstOfPrior = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const lastOfPrior = new Date(firstOfThis.getTime() - 86400000)
  const periodMonth = firstOfPrior.toISOString().slice(0, 7)

  const config = await readPricingConfig(admin)

  const { data: placements } = await admin
    .from('ad_placements')
    .select('tv_id, campaign_id, start_date')
    .eq('status', 'active')

  // Per-campaign billing basis, cached: the EFFECTIVE per-screen price the advertiser
  // actually pays (monthly total spread over its live screens, so discounts/floor are
  // reflected) plus the payee ids. Crediting the gross tier price would refund more
  // than was collected.
  type Basis = {
    perScreenCents: number | null
    advertiserId: string | null
    territoryId: string | null
    customerId: string | null
  }
  const campBasis = new Map<string, Basis | null>()
  async function basisFor(campaignId: string): Promise<Basis | null> {
    if (campBasis.has(campaignId)) return campBasis.get(campaignId) ?? null
    const [{ data: camp }, { count: screens }, { data: sub }] = await Promise.all([
      admin
        .from('campaigns')
        .select('advertiser_id, territory_id, monthly_total_cents')
        .eq('id', campaignId)
        .maybeSingle(),
      admin
        .from('ad_placements')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'active'),
      admin
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('campaign_id', campaignId)
        .maybeSingle(),
    ])
    const n = Math.max(1, screens ?? 1)
    const basis: Basis | null = camp
      ? {
          perScreenCents: camp.monthly_total_cents
            ? Math.round((camp.monthly_total_cents as number) / n)
            : null,
          advertiserId: (camp.advertiser_id as string | null) ?? null,
          territoryId: (camp.territory_id as string | null) ?? null,
          customerId: (sub?.stripe_customer_id as string | null) ?? null,
        }
      : null
    campBasis.set(campaignId, basis)
    return basis
  }

  const results: Array<Record<string, unknown>> = []

  for (const p of (placements ?? []) as {
    tv_id: string
    campaign_id: string
    start_date: string | null
  }[]) {
    try {
      const { data: tvRow } = await admin
        .from('tvs')
        .select(
          'id, venue:venues(id, price_tier, price_cents_override, foot_traffic_estimate, business_open, business_close, business_days, business_hours)'
        )
        .eq('id', p.tv_id)
        .maybeSingle()
      const venue = (tvRow as unknown as { venue: VenueRow | null } | null)?.venue
      if (!venue) continue

      // Only measure the slice of the prior month this placement was actually
      // running. A campaign placed mid-month (or on a screen with no prior-month
      // heartbeats) must not be credited for days it wasn't live or paying.
      const placementStart = p.start_date ? new Date(`${p.start_date}T00:00:00Z`) : firstOfPrior
      const effectiveStart = placementStart > firstOfPrior ? placementStart : firstOfPrior
      if (effectiveStart >= firstOfThis) continue // started this month; nothing to credit yet
      const effectiveWindowDays = Math.max(
        1,
        Math.round((firstOfThis.getTime() - effectiveStart.getTime()) / 86400000)
      )

      const { data: rows } = await admin
        .from('tv_uptime_days')
        .select('day, seconds')
        .eq('tv_id', p.tv_id)
        .gte('day', effectiveStart.toISOString().slice(0, 10))
        .lte('day', lastOfPrior.toISOString().slice(0, 10))

      const summary = summarizeUptime(
        (rows ?? []) as UptimeDay[],
        venueBusinessHours(venue),
        effectiveWindowDays,
        lastOfPrior
      )
      if (!summary.hasData || !summary.breach) continue

      const grossTier = venuePriceCents(
        venue.price_cents_override,
        (venue.price_tier as PriceTier | null) ?? suggestTier(venue.foot_traffic_estimate),
        config
      )
      const basis = await basisFor(p.campaign_id)
      // Credit the shortfall against the EFFECTIVE per-screen price (discounts/floor),
      // capped at the gross tier so add-ons folded into the monthly total can't inflate it.
      const effectivePrice = Math.min(grossTier, basis?.perScreenCents ?? grossTier)
      const creditCents = Math.round(effectivePrice * (UPTIME_SLA - summary.pct))
      if (creditCents <= 0) continue

      // Already credited this screen+campaign+month?
      const { data: existing } = await admin
        .from('credits')
        .select('id')
        .eq('tv_id', p.tv_id)
        .eq('campaign_id', p.campaign_id)
        .eq('reason', 'sla_uptime')
        .eq('period_month', periodMonth)
        .maybeSingle()
      if (existing) {
        results.push({ tv: p.tv_id, campaign: p.campaign_id, status: 'already-credited' })
        continue
      }

      if (dry) {
        results.push({
          tv: p.tv_id,
          campaign: p.campaign_id,
          pct: Math.round(summary.pct * 100) / 100,
          creditCents,
          status: 'dry',
        })
        continue
      }

      // Credit the customer's Stripe balance (negative = credit toward the next
      // invoice). A deterministic idempotency key makes the credit safe if the job
      // crashes after Stripe succeeds but before the ledger insert, or if two runs
      // overlap — Stripe returns the same transaction instead of double-crediting.
      let stripeRef: string | null = null
      if (process.env.STRIPE_SECRET_KEY && basis?.customerId) {
        try {
          const txn = await stripe().customers.createBalanceTransaction(
            basis.customerId,
            {
              amount: -creditCents,
              currency: 'usd',
              description: `Loop Network uptime credit — ${periodMonth} (${Math.round(summary.pct * 100)}% uptime)`,
            },
            { idempotencyKey: `sla-${p.tv_id}-${p.campaign_id}-${periodMonth}` }
          )
          stripeRef = txn.id
        } catch {
          /* record it anyway; an admin can reconcile */
        }
      }

      await admin.from('credits').insert({
        advertiser_id: basis?.advertiserId ?? null,
        campaign_id: p.campaign_id,
        tv_id: p.tv_id,
        territory_id: basis?.territoryId ?? null,
        amount_cents: creditCents,
        reason: 'sla_uptime',
        period_month: periodMonth,
        stripe_ref: stripeRef,
      })
      results.push({
        tv: p.tv_id,
        campaign: p.campaign_id,
        pct: Math.round(summary.pct * 100) / 100,
        creditCents,
        status: stripeRef ? 'credited' : 'recorded',
      })
    } catch (e) {
      results.push({ tv: p.tv_id, campaign: p.campaign_id, status: 'error', error: String(e) })
    }
  }

  return NextResponse.json({ month: periodMonth, breaches: results.length, results })
}
