'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

// Mark ads as a venue host's own ad, or clear the mark.
//
// It sets ads.host_venue_id, the column host promos already use. Nothing on the
// screens changes: the TV loop plays by placement, not by owner. What changes is
// how the admin reads the ad. It stops being flagged as airing after its campaign
// ended, and its screens count toward that host's two free per hosted screen.
export async function setHostVenue(adIds: string[], venueId: string | null) {
  await requireAdmin()
  if (!adIds.length) return { error: 'No ad to mark.' }
  const admin = createAdminClient()
  if (venueId) {
    const { data: v } = await admin.from('venues').select('id').eq('id', venueId).maybeSingle()
    if (!v) return { error: 'That venue no longer exists.' }
  }
  const { error } = await admin.from('ads').update({ host_venue_id: venueId }).in('id', adIds)
  if (error) return { error: error.message }
  revalidatePath('/admin', 'layout')
  return { error: null as string | null }
}
