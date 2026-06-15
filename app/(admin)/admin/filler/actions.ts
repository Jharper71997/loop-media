'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'

// Filler cards are admin-authored slides (trivia, local events, game-day notes,
// featured promos) that play between ads on every screen in a territory. Writes
// go through the RLS client; the filler_admin_write policy lets admins write
// rows for territories they manage.

export type FillerType = 'trivia' | 'event' | 'sports' | 'promo'

export interface FillerInput {
  id?: string
  territory_id: string
  type: FillerType
  headline: string
  sub?: string
  foot?: string
  expires_at?: string | null // ISO date or null = no expiry
  active?: boolean
}

export async function saveFiller(input: FillerInput) {
  await requireAdmin()
  if (!input.territory_id) return { error: 'Pick a territory first.' }
  if (!input.headline.trim()) return { error: 'Enter a headline.' }

  const supabase = await createClient()
  const row = {
    territory_id: input.territory_id,
    type: input.type,
    payload: {
      headline: input.headline.trim(),
      sub: input.sub?.trim() || undefined,
      foot: input.foot?.trim() || undefined,
    },
    active: input.active ?? true,
    expires_at: input.expires_at || null,
  }

  const { error } = input.id
    ? await supabase.from('filler_content').update(row).eq('id', input.id)
    : await supabase.from('filler_content').insert(row)
  if (error) return { error: error.message }

  revalidatePath('/admin/filler')
  return { error: null }
}

export async function toggleFiller(id: string, active: boolean) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('filler_content').update({ active }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/filler')
  return { error: null }
}

export async function deleteFiller(id: string) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase.from('filler_content').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/filler')
  return { error: null }
}
