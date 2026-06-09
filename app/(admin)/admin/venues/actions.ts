'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import { geocodeAddress } from '@/lib/geocode'
import type { PriceTier } from '@/lib/db.types'

export interface VenueInput {
  id?: string
  territory_id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  venue_type: string
  category_id: string | null
  foot_traffic_estimate: number
  price_tier: PriceTier | null
  category_slots: number
  contact_name: string
  contact_email: string
  contact_phone: string
  status: 'active' | 'inactive'
}

export async function saveVenue(input: VenueInput) {
  await requireAdmin()
  const supabase = await createClient()
  const { id, ...payload } = input

  // Auto-fill coordinates from the address so admins never type lat/lng.
  if ((payload.lat == null || payload.lng == null) && payload.address?.trim()) {
    const geo = await geocodeAddress(payload.address)
    if (geo) {
      payload.lat = geo.lat
      payload.lng = geo.lng
    }
  }

  const { error } = id
    ? await supabase.from('venues').update(payload).eq('id', id)
    : await supabase.from('venues').insert(payload)

  if (error) return { error: error.message }
  revalidatePath('/admin/venues')
  return { error: null }
}

// Show/hide a venue. Inactive venues are grayed out in admin and hidden from
// the advertiser map — use it to stage a location that isn't ready yet.
export async function setVenueStatus(id: string, status: 'active' | 'inactive') {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('venues').update({ status }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/venues')
  return { error: null }
}

export async function deleteVenue(id: string) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('venues').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/venues')
  return { error: null }
}
