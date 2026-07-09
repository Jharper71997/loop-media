'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { geocodeAddress } from '@/lib/geocode'
import { findOrCreateTerritory } from '@/lib/territory'

// Host self-service editing of THEIR OWN venue. `venues` / `venue_provisioning`
// are admin-write under RLS, so every write here runs with the service-role admin
// client and is gated by an app-layer ownership check (host_user_id === me, or an
// admin). Admin-controlled fields (status, pricing, foot traffic, comp code,
// agreement) are deliberately NOT editable here — a host only edits what they
// entered at registration.

export interface HostVenueInput {
  id: string
  name: string
  address: string
  city: string
  state: string
  postal_code: string
  category_id: string | null
  venue_type: string
  median_daily_customers: number | null
  contact_phone: string
  business_open: string
  business_close: string
  business_days: number[]
}

// Load a venue and confirm the caller owns it (or is an admin). Returns the venue
// row (with the fields callers need) or an error string.
async function loadOwnedVenue(
  admin: ReturnType<typeof createAdminClient>,
  profile: { id: string; role: string },
  venueId: string
) {
  const { data: venue } = await admin
    .from('venues')
    .select('id, host_user_id, city, state')
    .eq('id', venueId)
    .maybeSingle()
  if (!venue) return { error: 'Location not found.' as string, venue: null }
  if (profile.role !== 'admin' && venue.host_user_id !== profile.id) {
    return { error: 'That location is not on your account.' as string, venue: null }
  }
  return { error: null as string | null, venue }
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

export async function saveHostVenue(input: HostVenueInput) {
  const profile = await requireProfile()
  if (!input.name.trim()) return { error: 'Enter your venue name.' }
  if (!input.address.trim()) return { error: 'Enter your street address.' }
  if (!input.city.trim() || !input.state.trim()) return { error: 'Enter your city and state.' }
  if (!input.postal_code.trim()) return { error: 'Enter your ZIP code.' }
  if (!input.contact_phone.trim()) return { error: 'Enter a contact phone so we can reach you.' }

  const admin = createAdminClient()
  const { error: gateErr, venue } = await loadOwnedVenue(admin, profile, input.id)
  if (gateErr || !venue) return { error: gateErr ?? 'Location not found.' }

  // Re-geocode on every save so editing the address moves the map pin. Only write
  // coordinates when geocoding actually returned them — a transient failure must
  // NOT null out the pin (that would drop the venue off the advertiser map).
  const geo = await geocodeAddress({
    street: input.address,
    city: input.city,
    state: input.state,
    zip: input.postal_code,
  })

  // Moving cities changes the market. Re-derive the territory only when the city
  // or state actually changed (reusing the same helper as registration); otherwise
  // leave territory_id untouched so an unrelated edit never reshuffles the market.
  let territoryId: string | undefined
  if (norm(input.city) !== norm(venue.city) || norm(input.state) !== norm(venue.state)) {
    const t = await findOrCreateTerritory(admin, input.city, input.state)
    if (!t) return { error: 'Could not set up that city. Try again.' }
    territoryId = t
  }

  const payload = {
    name: input.name.trim(),
    address: input.address.trim() || null,
    city: input.city.trim() || null,
    state: input.state.trim() || null,
    postal_code: input.postal_code.trim() || null,
    venue_type: input.venue_type.trim() || null,
    category_id: input.category_id,
    // 0/empty means "not stated" -> null, so reach falls back to foot traffic / 30.
    median_daily_customers:
      input.median_daily_customers && input.median_daily_customers > 0
        ? Math.round(input.median_daily_customers)
        : null,
    contact_phone: input.contact_phone.trim() || null,
    business_open: input.business_open || null,
    business_close: input.business_close || null,
    business_days: input.business_days?.length ? input.business_days : null,
    ...(territoryId ? { territory_id: territoryId } : {}),
    ...(geo ? { lat: geo.lat, lng: geo.lng } : {}),
  }

  const { error } = await admin.from('venues').update(payload).eq('id', input.id)
  if (error) return { error: error.message }

  revalidatePath('/host')
  revalidatePath(`/host/venues/${input.id}/edit`)
  revalidatePath('/advertiser/browse')
  revalidatePath('/admin/map')
  return { error: null as string | null }
}

// Set (or clear) a venue's logo. Called by the LogoUploader after it uploads the
// image to the venue-logos bucket, and by "Remove logo" with null. Kept separate
// from saveHostVenue so a host can change the logo without re-submitting the form.
export async function setVenueLogo(venueId: string, logoUrl: string | null) {
  const profile = await requireProfile()
  // Only accept a URL that points at our public logo bucket (or null to clear) —
  // don't let an arbitrary string be written into logo_url.
  if (logoUrl !== null && !logoUrl.includes('/venue-logos/')) {
    return { error: 'Invalid logo URL.' }
  }
  const admin = createAdminClient()
  const { error: gateErr } = await loadOwnedVenue(admin, profile, venueId)
  if (gateErr) return { error: gateErr }

  const { error } = await admin.from('venues').update({ logo_url: logoUrl }).eq('id', venueId)
  if (error) return { error: error.message }

  revalidatePath('/host')
  revalidatePath(`/host/venues/${venueId}/edit`)
  revalidatePath('/advertiser/browse')
  revalidatePath('/admin/map')
  return { error: null as string | null }
}

export interface HostWifiInput {
  network_type: 'wifi' | 'ethernet'
  wifi_ssid: string
  // Blank = keep the current password (we never render the stored one back to the page).
  wifi_password: string
  network_note: string
}

// Update the venue's network details (venue_provisioning is service-role only —
// the WiFi password is a secret). Wired venues clear the WiFi fields; WiFi venues
// keep the existing password unless the host types a new one.
export async function saveHostWifi(venueId: string, input: HostWifiInput) {
  const profile = await requireProfile()
  const netType = input.network_type === 'ethernet' ? 'ethernet' : 'wifi'
  if (netType === 'wifi' && !input.wifi_ssid.trim()) {
    return { error: 'Enter your WiFi network name.' }
  }

  const admin = createAdminClient()
  const { error: gateErr } = await loadOwnedVenue(admin, profile, venueId)
  if (gateErr) return { error: gateErr }

  // Keep the stored password when the host leaves the field blank.
  const { data: existing } = await admin
    .from('venue_provisioning')
    .select('wifi_password')
    .eq('venue_id', venueId)
    .maybeSingle()
  const keepPassword = existing?.wifi_password ?? null

  const { error } = await admin.from('venue_provisioning').upsert({
    venue_id: venueId,
    network_type: netType,
    wifi_ssid: netType === 'wifi' ? input.wifi_ssid.trim() || null : null,
    wifi_password:
      netType === 'wifi' ? (input.wifi_password.trim() ? input.wifi_password : keepPassword) : null,
    network_note: input.network_note.trim() || null,
    updated_at: new Date().toISOString(),
  })
  if (error) return { error: error.message }

  revalidatePath(`/host/venues/${venueId}/edit`)
  return { error: null as string | null }
}
