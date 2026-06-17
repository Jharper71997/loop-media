'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import type { PriceTier } from '@/lib/pricing'

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
  const supabase = await createClient()
  const { error } = await supabase
    .from('pricing_config')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 'default')
  if (error) return { error: error.message }
  return done()
}

// Percent in the UI (20 = 20%), stored as a fraction (0.20).
function clampPct(value: number | null): number {
  return Math.min(Math.max(value ?? 0, 0), 100) / 100
}

// Tier price entered in dollars; stored as cents. Hard $75/screen floor.
export async function setTierPrice(tier: PriceTier, value: number | null) {
  await requireAdmin()
  if ((value ?? 0) < 75) return { error: "Screens can't be priced below $75." }
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
