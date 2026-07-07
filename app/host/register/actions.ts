'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { geocodeAddress } from '@/lib/geocode'
import { genPairingCode, TV_PAIRING_CODE_LEN, DEFAULT_LOOP_SECONDS, DEFAULT_SLOT_SECONDS } from '@/lib/tv'

export interface RegisterVenueInput {
  name: string
  address: string
  city: string
  state: string
  postal_code: string
  category_id: string | null
  venue_type: string | null
  foot_traffic_estimate: number
  contact_phone: string | null
  business_open?: string
  business_close?: string
  business_days?: number[]
  // Network details so we can program the venue's Pi before shipping it.
  network_type?: 'wifi' | 'ethernet'
  wifi_ssid?: string | null
  wifi_password?: string | null
  network_note?: string | null
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Normalize an address/ZIP for duplicate comparison: lowercase, collapse
// internal whitespace, trim, drop trailing punctuation. Used to enforce one
// screen per location (a host can't register the same address twice).
function normAddr(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,#\s]+$/g, '')
}

// A host can register a venue in ANY US city. The "market" (territory) is
// derived from the city + state they entered and created on the fly if it's
// new, so they're never limited to a pre-seeded list. Returns the territory id.
async function findOrCreateTerritory(
  admin: ReturnType<typeof createAdminClient>,
  city: string,
  state: string
): Promise<string | null> {
  const name = `${city.trim()}, ${state.trim().toUpperCase()}`
  const slug = slugify(name)
  const { data: existing } = await admin
    .from('territories')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (existing) return existing.id
  const { data: created } = await admin
    .from('territories')
    .insert({ name, slug, is_holding: false, status: 'active' })
    .select('id')
    .maybeSingle()
  return created?.id ?? null
}

// A host self-registers their venue. `venues` is admin-write under RLS, so this
// runs with the service role and creates the venue as INACTIVE + linked to the
// host. It then surfaces in /admin/venues for an admin to verify, set real foot
// traffic, and flip to active.
export async function requestVenue(input: RegisterVenueInput) {
  const profile = await requireProfile()
  if (profile.role !== 'host' && profile.role !== 'admin') {
    return { error: 'Only host accounts can register a venue.' }
  }
  if (!input.name.trim()) return { error: 'Enter your venue name.' }
  if (!input.address.trim()) return { error: 'Enter your street address.' }
  if (!input.city.trim() || !input.state.trim()) {
    return { error: 'Enter your city and state.' }
  }
  if (!input.postal_code.trim()) return { error: 'Enter your ZIP code.' }

  const admin = createAdminClient()

  // One screen per location: reject if this host already registered a venue at
  // the same street address + ZIP. Compared with a normalizer (tiny per-host
  // list, so we filter in JS rather than in SQL).
  const addrKey = `${normAddr(input.address)}|${normAddr(input.postal_code)}`
  const { data: myVenues } = await admin
    .from('venues')
    .select('address, postal_code')
    .eq('host_user_id', profile.id)
  if ((myVenues ?? []).some((v) => `${normAddr(v.address)}|${normAddr(v.postal_code)}` === addrKey)) {
    return { error: 'You already have a screen registered at this address.' }
  }

  const territoryId = await findOrCreateTerritory(admin, input.city, input.state)
  if (!territoryId) return { error: 'Could not set up your city. Try again.' }

  const geo = await geocodeAddress({
    street: input.address,
    city: input.city,
    state: input.state,
    zip: input.postal_code,
  })

  const { data: venue, error } = await admin
    .from('venues')
    .insert({
      territory_id: territoryId,
      name: input.name.trim(),
      address: input.address.trim() || null,
      city: input.city.trim() || null,
      state: input.state.trim() || null,
      postal_code: input.postal_code.trim() || null,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      venue_type: input.venue_type?.trim() || null,
      category_id: input.category_id,
      foot_traffic_estimate: Math.max(0, Math.round(input.foot_traffic_estimate || 0)),
      contact_name: profile.full_name || null,
      contact_email: profile.email,
      contact_phone: input.contact_phone?.trim() || null,
      host_user_id: profile.id,
      status: 'inactive',
      business_open: input.business_open || '10:00',
      business_close: input.business_close || '22:00',
      business_days:
        input.business_days && input.business_days.length ? input.business_days : [0, 1, 2, 3, 4, 5, 6],
    })
    .select('id')
    .single()
  if (error || !venue) return { error: error?.message ?? 'Could not save your venue.' }

  // One screen per location: give the new venue its single screen right away,
  // with a pairing code the host enters on their TV at /tv. Same pattern as the
  // old addScreen action, including the retry on a (rare) pairing-code clash.
  let tvError: string | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error: tvErr } = await admin.from('tvs').insert({
      venue_id: venue.id,
      pairing_code: genPairingCode(TV_PAIRING_CODE_LEN),
      status: 'unpaired',
      loop_length_seconds: DEFAULT_LOOP_SECONDS,
      slot_seconds: DEFAULT_SLOT_SECONDS,
    })
    if (!tvErr) {
      tvError = null
      break
    }
    tvError = tvErr.message
    if (!/duplicate|unique/i.test(tvErr.message)) break
  }
  if (tvError) return { error: tvError }

  // Optional network details for support. Only stored if the host actually
  // entered any — we no longer ship/pre-program hardware, so this is just a note.
  if (input.wifi_ssid?.trim() || input.wifi_password || input.network_note?.trim()) {
    const networkType = input.network_type === 'ethernet' ? 'ethernet' : 'wifi'
    await admin.from('venue_provisioning').upsert({
      venue_id: venue.id,
      network_type: networkType,
      wifi_ssid: networkType === 'wifi' ? input.wifi_ssid?.trim() || null : null,
      wifi_password: networkType === 'wifi' ? input.wifi_password || null : null,
      network_note: input.network_note?.trim() || null,
      updated_at: new Date().toISOString(),
    })
  }

  revalidatePath('/host')
  return { error: null }
}
