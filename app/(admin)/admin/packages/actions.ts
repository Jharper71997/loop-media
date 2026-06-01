'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

function done() {
  revalidatePath('/admin/packages')
  return { error: null as string | null }
}

export async function setPackageScreenCap(id: string, value: number | null) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('packages').update({ screen_cap: value }).eq('id', id)
  if (error) return { error: error.message }
  return done()
}

export async function setPackageGoal(id: string, value: number | null) {
  await requireAdmin()
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
  await requireAdmin()
  const supabase = await createClient()
  const cents = Math.max(0, Math.round((value ?? 0) * 100))
  const { error } = await supabase.from('packages').update({ base_price_cents: cents }).eq('id', id)
  if (error) return { error: error.message }
  return done()
}

export async function togglePackageActive(id: string, active: boolean) {
  await requireAdmin()
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
