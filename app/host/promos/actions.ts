'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'

export interface HostPromoInput {
  venue_id: string
  title: string
  creative_type: 'video' | 'image'
  creative_url: string
  qr_target_url: string | null
}

export async function submitHostPromo(
  input: HostPromoInput
): Promise<{ error: string | null }> {
  const profile = await requireProfile()
  if (profile.role !== 'host') return { error: 'Only host venues can add promos.' }
  if (!input.title.trim()) return { error: 'Give your promo a title.' }
  if (!input.creative_url) return { error: 'Upload a promo image or video.' }

  const supabase = await createClient()

  // Confirm the venue is one this host actually runs.
  const { data: venue } = await supabase
    .from('venues')
    .select('id, territory_id, category_id, host_user_id')
    .eq('id', input.venue_id)
    .maybeSingle()
  if (!venue || venue.host_user_id !== profile.id) {
    return { error: 'That venue is not linked to your account.' }
  }

  const { error } = await supabase.from('ads').insert({
    owner_user_id: profile.id,
    owner_kind: 'host',
    territory_id: venue.territory_id,
    category_id: venue.category_id, // host promo inherits the venue's category
    host_venue_id: venue.id,
    title: input.title.trim(),
    creative_type: input.creative_type,
    creative_url: input.creative_url,
    status: 'pending',
    qr_target_url: input.qr_target_url || null,
  })
  if (error) {
    // The DB trigger raises this when the 3-slot cap is hit.
    if (/promo limit/i.test(error.message)) {
      return { error: 'You already have 3 promo slots in use. Remove one to add another.' }
    }
    return { error: error.message }
  }

  revalidatePath('/host/promos')
  revalidatePath('/host')
  return { error: null }
}

export async function deleteHostPromo(id: string): Promise<{ error: string | null }> {
  const profile = await requireProfile()
  if (profile.role !== 'host') return { error: 'Not allowed.' }

  const supabase = await createClient()
  // RLS already restricts deletes to the owner; scope explicitly too.
  const { error } = await supabase
    .from('ads')
    .delete()
    .eq('id', id)
    .eq('owner_user_id', profile.id)
    .eq('owner_kind', 'host')
  if (error) return { error: error.message }

  revalidatePath('/host/promos')
  revalidatePath('/host')
  return { error: null }
}
