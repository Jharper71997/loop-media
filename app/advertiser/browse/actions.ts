'use server'

import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'

// Save the advertiser's chosen line of business to their profile so we ask it
// ONCE (here, in browse Step 1) and reuse it on the creative step + every future
// campaign. Called when they pick a real category; 'all'/no-category is ignored
// so it doesn't wipe a previously saved one.
export async function rememberCategory(
  categoryId: string | null
): Promise<{ ok?: boolean; error?: string }> {
  if (!categoryId || categoryId === 'all') return { ok: true }
  const profile = await requireProfile()
  if (!['advertiser', 'host', 'admin'].includes(profile.role)) return { ok: true }
  const supabase = await createClient()
  const { error } = await supabase
    .from('profiles')
    .update({ category_id: categoryId })
    .eq('id', profile.id)
  if (error) return { error: error.message }
  return { ok: true }
}

// "Notify me" — join the waitlist for a (venue, category) that's currently full
// for this advertiser's category. When a slot frees up, an admin/cron can notify.
export async function joinWaitlist(
  venueId: string,
  categoryId: string | null
): Promise<{ ok?: boolean; error?: string }> {
  const profile = await requireProfile()
  if (!['advertiser', 'admin', 'host'].includes(profile.role)) {
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
  if (!['advertiser', 'admin', 'host'].includes(profile.role)) {
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
