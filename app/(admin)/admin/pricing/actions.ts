'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, isGlobalAdmin } from '@/lib/auth'
import { DEFAULT_PRICING_CONFIG, type PriceTier } from '@/lib/pricing'

const TIER_COLUMN: Record<PriceTier, string> = {
  local: 'local_price_cents',
  standard: 'standard_price_cents',
  high: 'high_price_cents',
  premium: 'premium_price_cents',
}

function done() {
  // Prices surface on the editor, the venues list, and the advertiser cart.
  revalidatePath('/admin/pricing')
  revalidatePath('/admin/venues')
  revalidatePath('/advertiser/browse')
  return { error: null as string | null }
}

async function updateConfig(patch: Record<string, number>) {
  // pricing_config is a single global row that drives the whole network's prices,
  // so only a global (Holdings) admin may edit it — not a city-scoped admin.
  const profile = await requireAdmin()
  if (!isGlobalAdmin(profile))
    return { error: 'Only a network (Holdings) admin can change global pricing.' }
  const supabase = await createClient()

  // Read-modify-write upsert. A bare .update().eq('id','default') silently
  // matches 0 rows when the pricing_config row doesn't exist yet (fresh
  // deployment), so edits vanished. Read the current row (or fall back to the
  // code default — flat $50), then upsert a COMPLETE row so a first write can't
  // inherit the table's column DEFAULTS for the fields we didn't touch.
  const { data: existing } = await supabase
    .from('pricing_config')
    .select('*')
    .eq('id', 'default')
    .maybeSingle()

  const d = DEFAULT_PRICING_CONFIG
  const base = existing ?? {
    local_price_cents: d.tierPriceCents.local,
    standard_price_cents: d.tierPriceCents.standard,
    high_price_cents: d.tierPriceCents.high,
    premium_price_cents: d.tierPriceCents.premium,
    min_monthly_cents: d.minMonthlyCents,
    host_discount_pct: d.hostDiscount,
    loyalty_12mo_discount_pct: d.loyalty12moDiscount,
    max_discount_pct: d.maxDiscount,
  }

  const { error } = await supabase
    .from('pricing_config')
    .upsert(
      { ...base, ...patch, id: 'default', updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    )
  if (error) return { error: error.message }
  return done()
}

// Percent in the UI (20 = 20%), stored as a fraction (0.20).
function clampPct(value: number | null): number {
  return Math.min(Math.max(value ?? 0, 0), 100) / 100
}

// Tier price entered in dollars; stored as cents. Hard $25/screen floor (the
// flat rate is $50/screen; the floor only stops fat-finger sub-$25 prices).
export async function setTierPrice(tier: PriceTier, value: number | null) {
  await requireAdmin()
  if ((value ?? 0) < 25) return { error: "Screens can't be priced below $25." }
  return updateConfig({ [TIER_COLUMN[tier]]: Math.round((value as number) * 100) })
}

// Account minimum entered in dollars; stored as cents.
export async function setMinMonthly(value: number | null) {
  await requireAdmin()
  return updateConfig({ min_monthly_cents: Math.max(0, Math.round((value ?? 0) * 100)) })
}

export async function setHostDiscount(value: number | null) {
  await requireAdmin()
  return updateConfig({ host_discount_pct: clampPct(value) })
}

export async function setLoyaltyDiscount(value: number | null) {
  await requireAdmin()
  return updateConfig({ loyalty_12mo_discount_pct: clampPct(value) })
}

export async function setMaxDiscount(value: number | null) {
  await requireAdmin()
  return updateConfig({ max_discount_pct: clampPct(value) })
}
