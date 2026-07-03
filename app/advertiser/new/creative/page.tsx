import { requireProfile, homeForRole } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { PriceTier } from '@/lib/db.types'
import { suggestTier, venuePriceCents, type QuoteOptions } from '@/lib/pricing'
import {
  resolveAdvertiserContext,
  contextToQuoteOptions,
  getPricingConfig,
} from '@/lib/pricing.server'
import { CreativeStep } from '../CreativeStep'
import type { CartVenue } from '../types'

export default async function CreativePage() {
  const profile = await requireProfile()
  if (!['advertiser', 'admin', 'host'].includes(profile.role)) {
    redirect(homeForRole(profile.role))
  }
  const supabase = await createClient()

  const [{ data: cats }, { data: venueRows }, ctx, pricingConfig] = await Promise.all([
    supabase.from('categories').select('id, name').order('name'),
    supabase
      .from('venues')
      .select('id, territory_id, name, category_id, foot_traffic_estimate, price_tier, price_cents_override')
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
    price_tier: PriceTier | null
    price_cents_override: number | null
  }
  const venues: CartVenue[] = ((venueRows ?? []) as VRow[]).map((r) => {
    const tier: PriceTier = r.price_tier ?? suggestTier(r.foot_traffic_estimate)
    return {
      id: r.id,
      territoryId: r.territory_id,
      name: r.name,
      categoryId: r.category_id,
      footTraffic: r.foot_traffic_estimate,
      tier,
      priceCents: venuePriceCents(r.price_cents_override, tier, pricingConfig),
    }
  })

  const quoteOpts: QuoteOptions = contextToQuoteOptions(ctx)
  return (
    <CreativeStep
      userId={profile.id}
      categories={(cats ?? []) as { id: string; name: string }[]}
      defaultCategoryId={profile.category_id}
      venues={venues}
      quoteOpts={quoteOpts}
      pricingConfig={pricingConfig}
    />
  )
}
