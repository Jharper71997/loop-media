'use server'

import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'

// "Notify me" — join the waitlist for a (venue, category) that's currently full
// for this advertiser's category. When a slot frees up, an admin/cron can notify.
export async function joinWaitlist(
  venueId: string,
  categoryId: string | null
): Promise<{ ok?: boolean; error?: string }> {
  const profile = await requireProfile()
  if (profile.role !== 'advertiser' && profile.role !== 'admin') {
    return { error: 'Only advertisers can join a waitlist.' }
  }
  const supabase = await createClient()
  const { error } = await supabase.from('venue_waitlist').upsert(
    {
      venue_id: venueId,
      category_id: categoryId,
      advertiser_id: profile.id,
    },
    { onConflict: 'venue_id,category_id,advertiser_id' }
  )
  if (error) return { error: error.message }
  return { ok: true }
}

// "Other" — the advertiser's business type isn't in the catalog. Record it for
// admin review (they approve → it becomes a real category, or dismiss).
export async function requestCategory(
  name: string
): Promise<{ ok?: boolean; error?: string }> {
  const profile = await requireProfile()
  if (profile.role !== 'advertiser' && profile.role !== 'admin') {
    return { error: 'Only advertisers can request a category.' }
  }
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Tell us what you sell.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('category_requests')
    .insert({ advertiser_id: profile.id, proposed_name: trimmed })
  if (error) return { error: error.message }
  return { ok: true }
}

export async function leaveWaitlist(
  venueId: string,
  categoryId: string | null
): Promise<{ ok?: boolean; error?: string }> {
  const profile = await requireProfile()
  const supabase = await createClient()
  let q = supabase
    .from('venue_waitlist')
    .delete()
    .eq('venue_id', venueId)
    .eq('advertiser_id', profile.id)
  q = categoryId ? q.eq('category_id', categoryId) : q.is('category_id', null)
  const { error } = await q
  if (error) return { error: error.message }
  return { ok: true }
}
