'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { geocodeAddress } from '@/lib/geocode'

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
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
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
  if (!input.city.trim() || !input.state.trim()) {
    return { error: 'Enter your city and state.' }
  }

  const admin = createAdminClient()
  const territoryId = await findOrCreateTerritory(admin, input.city, input.state)
  if (!territoryId) return { error: 'Could not set up your city. Try again.' }

  const geo = await geocodeAddress({
    street: input.address,
    city: input.city,
    state: input.state,
    zip: input.postal_code,
  })

  const { error } = await admin.from('venues').insert({
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
  if (error) return { error: error.message }

  revalidatePath('/host')
  return { error: null }
}
