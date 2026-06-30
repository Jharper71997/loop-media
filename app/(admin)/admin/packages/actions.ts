'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, isGlobalAdmin } from '@/lib/auth'

function done() {
  // The package editors live on /admin/pricing now (/admin/packages just redirects
  // there), so invalidate the page the user is actually looking at.
  revalidatePath('/admin/pricing')
  return { error: null as string | null }
}

// Base packages are global templates, so only a network (Holdings) admin edits
// them — a city admin can't rewrite another territory's (or the shared) package.
async function gateGlobal(): Promise<string | null> {
  const profile = await requireAdmin()
  return isGlobalAdmin(profile) ? null : 'Only a network (Holdings) admin can edit packages.'
}

export async function setPackageScreenCap(id: string, value: number | null) {
  const denied = await gateGlobal()
  if (denied) return { error: denied }
  const supabase = await createClient()
  const { error } = await supabase.from('packages').update({ screen_cap: value }).eq('id', id)
  if (error) return { error: error.message }
  return done()
}

export async function setPackageGoal(id: string, value: number | null) {
  const denied = await gateGlobal()
  if (denied) return { error: denied }
  const supabase = await createClient()
  const { error } = await supabase
    .from('packages')
    .update({ target_impressions: value ?? 0 })
    .eq('id', id)
  if (error) return { error: error.message }
  return done()
}

// value is in dollars (the UI edits dollars); stored as cents.
export async function setPackagePrice(id: string, value: number | null) {
  const denied = await gateGlobal()
  if (denied) return { error: denied }
  const supabase = await createClient()
  const cents = Math.max(0, Math.round((value ?? 0) * 100))
  const { error } = await supabase.from('packages').update({ base_price_cents: cents }).eq('id', id)
  if (error) return { error: error.message }
  return done()
}

export async function togglePackageActive(id: string, active: boolean) {
  const denied = await gateGlobal()
  if (denied) return { error: denied }
  const supabase = await createClient()
  const { error } = await supabase.from('packages').update({ active }).eq('id', id)
  if (error) return { error: error.message }
  return done()
}

// Per-territory price override (dollars). null/empty clears the override so the
// package base price applies again.
export async function setTerritoryPrice(
  packageId: string,
  territoryId: string,
  value: number | null
) {
  await requireAdmin()
  const supabase = await createClient()
  if (value == null) {
    const { error } = await supabase
      .from('package_territory_prices')
      .delete()
      .eq('package_id', packageId)
      .eq('territory_id', territoryId)
    if (error) return { error: error.message }
    return done()
  }
  const cents = Math.max(0, Math.round(value * 100))
  const { error } = await supabase
    .from('package_territory_prices')
    .upsert(
      { package_id: packageId, territory_id: territoryId, price_cents: cents },
      { onConflict: 'package_id,territory_id' }
    )
  if (error) return { error: error.message }
  return done()
}
