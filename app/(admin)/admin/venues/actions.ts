'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

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
  contact_name: string
  contact_email: string
  contact_phone: string
  status: 'active' | 'inactive'
}

export async function saveVenue(input: VenueInput) {
  await requireAdmin()
  const supabase = await createClient()
  const { id, ...payload } = input

  const { error } = id
    ? await supabase.from('venues').update(payload).eq('id', id)
    : await supabase.from('venues').insert(payload)

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
