// Server-only pricing helpers. Kept apart from lib/pricing.ts (which is pure and
// client-safe) so importing the cart math into a Client Component never drags
// next/headers into the browser bundle.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import {
  quoteCart,
  suggestTier,
  loyaltyCredits,
  DEFAULT_PRICING_CONFIG,
  type PriceTier,
  type PricingConfig,
  type Quote,
  type QuoteOptions,
} from '@/lib/pricing'

// Read the editable pricing knobs from the DB (admin-tunable at /admin/pricing).
// Falls back to DEFAULT_PRICING_CONFIG if the row/table is missing. Cached per
// request so a page that prices many venues only hits the DB once.
export const getPricingConfig = cache(async (): Promise<PricingConfig> => {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('pricing_config')
      .select(
        'local_price_cents, standard_price_cents, high_price_cents, premium_price_cents, min_monthly_cents, host_discount_pct, loyalty_12mo_discount_pct, max_discount_pct'
      )
      .eq('id', 'default')
      .maybeSingle()
    const row = data as {
      local_price_cents: number
      standard_price_cents: number
      high_price_cents: number
      premium_price_cents: number
      min_monthly_cents: number
      host_discount_pct: number | string
      loyalty_12mo_discount_pct: number | string
      max_discount_pct: number | string
    } | null
    if (!row) return DEFAULT_PRICING_CONFIG
    return {
      tierPriceCents: {
        local: row.local_price_cents,
        standard: row.standard_price_cents,
        high: row.high_price_cents,
        premium: row.premium_price_cents,
      },
      minMonthlyCents: row.min_monthly_cents,
      hostDiscount: Number(row.host_discount_pct),
      loyalty12moDiscount: Number(row.loyalty_12mo_discount_pct),
      maxDiscount: Number(row.max_discount_pct),
    }
  } catch {
    return DEFAULT_PRICING_CONFIG
  }
})

// Re-price a set of picked venues from the DB (never trust a client-supplied
// total). Returns the authoritative cents to bill, plus the per-venue tiers.
export async function resolveCartCents(
  venueIds: string[],
  opts: QuoteOptions = {}
): Promise<{ totalCents: number; tiers: PriceTier[]; quote: Quote }> {
  const config = await getPricingConfig()
  const ids = [...new Set(venueIds.filter(Boolean))]
  if (!ids.length) return { totalCents: 0, tiers: [], quote: quoteCart([], opts, config) }

  const supabase = await createClient()
  const { data } = await supabase
    .from('venues')
    .select('id, price_tier, foot_traffic_estimate')
    .in('id', ids)
    .eq('status', 'active')

  const tiers: PriceTier[] = (data ?? []).map(
    (v: { price_tier: PriceTier | null; foot_traffic_estimate: number }) =>
      v.price_tier ?? suggestTier(v.foot_traffic_estimate)
  )
  const quote = quoteCart(tiers, opts, config)
  return { totalCents: quote.totalCents, tiers, quote }
}

// An advertiser's standing, used for loyalty perks + the host 20% discount.
//   monthsActive   — months since their earliest still-active subscription
//   screensRunning — distinct TVs they're currently live on
//   isHost         — they own at least one venue in the network
export interface AdvertiserContext {
  monthsActive: number
  screensRunning: number
  isHost: boolean
}

// Full CALENDAR months between two dates (not 30-day buckets, which unlocked the
// 12-month loyalty tier ~5 days early).
function fullMonthsBetween(a: Date, b: Date): number {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) m -= 1 // haven't reached the anniversary day yet
  return Math.max(0, m)
}

export async function resolveAdvertiserContext(userId: string): Promise<AdvertiserContext> {
  const supabase = await createClient()

  const [{ data: subs }, { data: camps }, { count: venueCount }] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('created_at')
      .eq('advertiser_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1),
    supabase.from('campaigns').select('id').eq('advertiser_id', userId).eq('status', 'active'),
    supabase
      .from('venues')
      .select('id', { count: 'exact', head: true })
      .eq('host_user_id', userId),
  ])

  const since = subs?.[0]?.created_at ? new Date(subs[0].created_at) : null
  const monthsActive = since ? fullMonthsBetween(since, new Date()) : 0

  let screensRunning = 0
  const campIds = (camps ?? []).map((c) => c.id)
  if (campIds.length) {
    const { data: pls } = await supabase
      .from('ad_placements')
      .select('tv_id')
      .in('campaign_id', campIds)
      .eq('status', 'active')
    screensRunning = new Set((pls ?? []).map((p) => p.tv_id)).size
  }

  return { monthsActive, screensRunning, isHost: (venueCount ?? 0) > 0 }
}

// Turn an advertiser's standing into the discount options quoteCart expects.
export function contextToQuoteOptions(ctx: AdvertiserContext): QuoteOptions {
  const credits = loyaltyCredits({
    monthsActive: ctx.monthsActive,
    screensRunning: ctx.screensRunning,
  })
  return {
    isHost: ctx.isHost,
    loyalty12mo: credits.loyalty12mo,
    freeScreens: credits.freeScreens,
  }
}
