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
  city: string
  state: string
  postal_code: string
  venue_type: string
  category_id: string | null
  host_user_id: string | null
  foot_traffic_estimate: number
  price_tier: PriceTier | null
  category_slots: number
  contact_name: string
  contact_email: string
  contact_phone: string
  status: 'active' | 'inactive'
  // Local wall-clock 'HH:MM' open/close and days open (0=Sun..6=Sat). Drive the
  // open-hours filter that scopes ad impressions to when the venue is actually
  // open (see lib/openHours.ts).
  business_open: string
  business_close: string
  business_days: number[]
}

export async function saveVenue(input: VenueInput) {
  await requireAdmin()
  const supabase = await createClient()
  const { id, ...rest } = input

  // Coordinates come ONLY from the address (no lat/lng inputs). Re-geocode on
  // every save so editing the address moves the pin.
  const geo = await geocodeAddress({
    street: rest.address,
    city: rest.city,
    state: rest.state,
    zip: rest.postal_code,
  })
  // Only write coordinates when geocoding actually returned them. A transient
  // geocode failure must NOT null out an existing venue's pin — that would drop
  // it off the advertiser map (and out of the coming-soon list).
  const payload = {
    ...rest,
    host_user_id: rest.host_user_id || null,
    // Empty time inputs -> null so the fallback hours apply; no days selected ->
    // null (treated as open every day by the filter).
    business_open: rest.business_open || null,
    business_close: rest.business_close || null,
    business_days: rest.business_days?.length ? rest.business_days : null,
    ...(geo ? { lat: geo.lat, lng: geo.lng } : {}),
  }

  const { error } = id
    ? await supabase.from('venues').update(payload).eq('id', id)
    : await supabase.from('venues').insert(payload)

  if (error) return { error: error.message }
  revalidatePath('/admin/venues')
  revalidatePath('/admin/map')
  return { error: null }
}

// Turn the phone-trivia game on/off for a venue's screens. Off by default — the
// TV loop only shows trivia (and mints a play_code) where it's been enabled.
export async function setVenueTrivia(id: string, enabled: boolean) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('venues').update({ trivia_enabled: enabled }).eq('id', id)
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
