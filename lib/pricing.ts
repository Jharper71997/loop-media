import { createClient } from '@/lib/supabase/server'

// Resolve the monthly price for a package in a territory. Per-territory override
// wins over the package base price. Custom (no package) ≈ $5 CPM, $99 floor.
export async function resolvePriceCents(
  packageId: string | null,
  territoryId: string,
  targetImpressions: number
): Promise<number> {
  if (!packageId) {
    return Math.max(9900, Math.round(targetImpressions / 1000) * 500)
  }
  const supabase = await createClient()
  const { data: override } = await supabase
    .from('package_territory_prices')
    .select('price_cents')
    .eq('package_id', packageId)
    .eq('territory_id', territoryId)
    .maybeSingle()
  if (override?.price_cents != null) return override.price_cents

  const { data: pkg } = await supabase
    .from('packages')
    .select('base_price_cents')
    .eq('id', packageId)
    .maybeSingle()
  return pkg?.base_price_cents ?? 0
}
