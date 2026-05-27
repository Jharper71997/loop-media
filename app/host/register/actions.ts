'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export interface RegisterVenueInput {
  name: string
  address: string
  territory_id: string
  category_id: string | null
  venue_type: string | null
  foot_traffic_estimate: number
  contact_phone: string | null
}

// A host self-registers their venue. `venues` is admin-write under RLS, so this
// runs with the service role and creates the venue as INACTIVE + linked to the
// host. It then surfaces in /admin/venues for an admin to verify, set real foot
// traffic, and flip to active.
export async function requestVenue(input: RegisterVenueInput) {
  const profile = await requireProfile()
  if (profile.role !== 'host') return { error: 'Only host accounts can register a venue.' }
  if (!input.name.trim()) return { error: 'Enter your venue name.' }
  if (!input.territory_id) return { error: 'Pick your city.' }

  const admin = createAdminClient()
  const { error } = await admin.from('venues').insert({
    territory_id: input.territory_id,
    name: input.name.trim(),
    address: input.address.trim() || null,
    venue_type: input.venue_type?.trim() || null,
    category_id: input.category_id,
    foot_traffic_estimate: Math.max(0, Math.round(input.foot_traffic_estimate || 0)),
    contact_name: profile.full_name || null,
    contact_email: profile.email,
    contact_phone: input.contact_phone?.trim() || null,
    host_user_id: profile.id,
    status: 'inactive',
  })
  if (error) return { error: error.message }

  revalidatePath('/host')
  return { error: null }
}
