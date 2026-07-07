'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth'
import { geocodeAddress } from '@/lib/geocode'
import {
  genPairingCode,
  TV_PAIRING_CODE_LEN,
  DEFAULT_LOOP_SECONDS,
  DEFAULT_SLOT_SECONDS,
} from '@/lib/tv'
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
  // Optional per-venue monthly price in cents. null = use the tier price.
  price_cents_override: number | null
  // Optional per-venue exclusivity upcharge in cents. null = use the network default.
  exclusivity_price_cents: number | null
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
  // New venues only: also stand up the first screen with a pairing code, so a
  // location isn't created then left with "no screen yet" as a separate step.
  create_screen?: boolean
}

export async function saveVenue(input: VenueInput) {
  await requireAdmin()
  const supabase = await createClient()
  const { id, create_screen, ...rest } = input

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

  if (id) {
    const { error } = await supabase.from('venues').update(payload).eq('id', id)
    if (error) return { error: error.message }
  } else {
    const { data: created, error } = await supabase
      .from('venues')
      .insert(payload)
      .select('id')
      .single()
    if (error || !created) return { error: error?.message ?? 'Could not create venue.' }

    // Stand up the first screen right away (same pattern as host self-registration)
    // so the location is usable without a second click. Best-effort with a retry on
    // the rare pairing-code clash.
    if (create_screen) {
      const admin = createAdminClient()
      for (let attempt = 0; attempt < 5; attempt++) {
        const { error: tvErr } = await admin.from('tvs').insert({
          venue_id: created.id,
          pairing_code: genPairingCode(TV_PAIRING_CODE_LEN),
          status: 'unpaired',
          loop_length_seconds: DEFAULT_LOOP_SECONDS,
          slot_seconds: DEFAULT_SLOT_SECONDS,
        })
        if (!tvErr) break
        if (!/duplicate|unique/i.test(tvErr.message)) break
      }
    }
  }

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
