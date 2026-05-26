'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth'
import { activatePlacementsIfReady } from '@/lib/placement'

export async function approveAd(id: string) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('ads')
    .update({
      status: 'approved',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq('id', id)
  if (error) return { error: error.message }

  // Now that the ad is approved, place any active (paid) campaigns using it.
  const admin = createAdminClient()
  const { data: campaigns } = await admin.from('campaigns').select('id').eq('ad_id', id)
  for (const c of campaigns ?? []) {
    await activatePlacementsIfReady(c.id, admin)
  }

  revalidatePath('/admin/queue')
  return { error: null }
}

export async function rejectAd(id: string, reason: string) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('ads')
    .update({
      status: 'rejected',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason || 'Not specified',
    })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/queue')
  return { error: null }
}
