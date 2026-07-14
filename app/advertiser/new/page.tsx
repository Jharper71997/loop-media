import { requireProfile, homeForRole } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PriceTier } from '@/lib/db.types'
import { suggestTier, venuePriceCents, venueExclusivityCents, type QuoteOptions } from '@/lib/pricing'
import {
  resolveAdvertiserContext,
  contextToQuoteOptions,
  getPricingConfig,
} from '@/lib/pricing.server'
import { availableExclusiveVenueIds } from '@/lib/exclusivity'
import { formatOpenHours } from '@/lib/openHours'
import { ReviewStep } from './ReviewStep'
import type { CartVenue } from './types'

export default async function ReviewPage() {
  const profile = await requireProfile()
  if (!['advertiser', 'admin', 'host'].includes(profile.role)) {
    redirect(homeForRole(profile.role))
  }
  const supabase = await createClient()

  const [{ data: venueRows }, ctx, pricingConfig] = await Promise.all([
    supabase
      .from('venues')
      .select(
        'id, territory_id, name, category_id, foot_traffic_estimate, median_daily_customers, price_tier, price_cents_override, exclusivity_price_cents, business_open, business_close, business_days, business_hours'
      )
      .eq('status', 'active'),
    resolveAdvertiserContext(profile.id),
    getPricingConfig(),
  ])

  type VRow = {
    id: string
    territory_id: string
    name: string
    category_id: string | null
    foot_traffic_estimate: number
    median_daily_customers: number | null
    price_tier: PriceTier | null
    price_cents_override: number | null
    exclusivity_price_cents: number | null
    business_open: string | null
    business_close: string | null
    business_days: number[] | null
    business_hours: Record<string, { open: string; close: string }> | null
  }
  const rows = (venueRows ?? []) as VRow[]

  // Exclusivity is per the buyer's locked line of business. Compute, in one batch,
  // which venues they can buy it at (no same-category competitor active, not already
  // taken). No category on the profile = nothing to sell.
  let availableExcl = new Set<string>()
  if (profile.category_id) {
    const admin = createAdminClient()
    availableExcl = await availableExclusiveVenueIds(
      admin,
      profile.category_id,
      profile.id,
      rows.map((r) => r.id)
    )
  }

  const venues: CartVenue[] = rows.map((r) => {
    const tier: PriceTier = r.price_tier ?? suggestTier(r.foot_traffic_estimate)
    return {
      id: r.id,
      territoryId: r.territory_id,
      name: r.name,
      categoryId: r.category_id,
      footTraffic: r.foot_traffic_estimate,
      medianDailyCustomers: r.median_daily_customers,
      tier,
      priceCents: venuePriceCents(r.price_cents_override, tier, pricingConfig),
      openHours: formatOpenHours(r),
      exclusivityCents: venueExclusivityCents(r.exclusivity_price_cents, pricingConfig),
      exclusivityAvailable: availableExcl.has(r.id),
    }
  })

  const quoteOpts: QuoteOptions = contextToQuoteOptions(ctx)
  return <ReviewStep venues={venues} quoteOpts={quoteOpts} pricingConfig={pricingConfig} />
}
