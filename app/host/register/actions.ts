'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { geocodeAddress } from '@/lib/geocode'
import { genPairingCode, TV_PAIRING_CODE_LEN, DEFAULT_LOOP_SECONDS, DEFAULT_SLOT_SECONDS } from '@/lib/tv'
import { AGREEMENT_VERSION } from '@/lib/agreement'
import { DEMO_COMP_CODE } from '@/lib/demo'
import { findOrCreateTerritory } from '@/lib/territory'

export interface RegisterVenueInput {
  name: string
  address: string
  city: string
  state: string
  postal_code: string
  category_id: string | null
  venue_type: string | null
  foot_traffic_estimate: number
  // Host-stated typical customers per day; drives reach directly when set.
  median_daily_customers?: number | null
  contact_phone: string | null
  business_open?: string
  business_close?: string
  business_days?: number[]
  // Typed signature + version of the Advertising Service Agreement the host
  // accepts at registration (see lib/agreement.ts).
  agreement_signer_name: string
  agreement_version?: string
  // Network details so we can program the venue's Pi before shipping it.
  network_type?: 'wifi' | 'ethernet'
  wifi_ssid?: string | null
  wifi_password?: string | null
  network_note?: string | null
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
  if (!input.agreement_signer_name?.trim()) {
    return { error: 'Type your name to sign the Advertising Service Agreement.' }
  }
  if (!input.median_daily_customers || input.median_daily_customers <= 0) {
    return { error: 'Enter your typical traffic per day.' }
  }
  if (!input.contact_phone?.trim()) {
    return { error: 'Enter a contact phone so we can reach you.' }
  }
  const netType = input.network_type === 'ethernet' ? 'ethernet' : 'wifi'
  if (netType === 'wifi' && (!input.wifi_ssid?.trim() || !input.wifi_password?.trim())) {
    return { error: 'Enter your WiFi network name and password.' }
  }

  const admin = createAdminClient()

  // Demo accounts skip the real "pending review → schedule a Fire Stick" wait: the
  // venue is created live and its screen is marked online, so the dashboard + comp
  // code are immediately populated for the walkthrough. is_demo keeps it off the
  // real buy map + admin + TVs (migration 0053).
  const isDemo = profile.is_demo

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
      median_daily_customers:
        input.median_daily_customers && input.median_daily_customers > 0
          ? Math.round(input.median_daily_customers)
          : null,
      contact_name: profile.full_name || null,
      contact_email: profile.email,
      contact_phone: input.contact_phone?.trim() || null,
      host_user_id: profile.id,
      status: isDemo ? 'active' : 'inactive',
      is_demo: isDemo,
      comp_promo_code: isDemo ? DEMO_COMP_CODE : null,
      agreement_signed_at: new Date().toISOString(),
      agreement_signer_name: input.agreement_signer_name.trim(),
      agreement_version: input.agreement_version || AGREEMENT_VERSION,
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

  // Demo: pretend the Fire Stick is already set up and checked in, so the host
  // dashboard reads as live (screen online, comp code active) the moment they
  // land — no waiting on a real pairing.
  if (isDemo) {
    await admin
      .from('tvs')
      // device_id is UNIQUE, so it must be per-venue — a constant collides on the
      // 2nd demo and leaves the screen "not paired". venue.id is a fresh UUID.
      .update({ device_id: `demo-${venue.id}`, last_heartbeat_at: new Date().toISOString() })
      .eq('venue_id', venue.id)
  }

  // Network details for support (required at registration). Wired venues store
  // just the ethernet choice; WiFi venues store SSID + password.
  {
    await admin.from('venue_provisioning').upsert({
      venue_id: venue.id,
      network_type: netType,
      wifi_ssid: netType === 'wifi' ? input.wifi_ssid?.trim() || null : null,
      wifi_password: netType === 'wifi' ? input.wifi_password || null : null,
      network_note: input.network_note?.trim() || null,
      updated_at: new Date().toISOString(),
    })
  }

  revalidatePath('/host')
  return { error: null }
}
