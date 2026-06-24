'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

// A host removes one of THEIR locations. Under the one-screen-per-location model
// this deletes the venue and — via ON DELETE CASCADE — its screen, that screen's
// ad_placements, uptime rows and placement exclusions. Play/scan history survives
// (tv_id is set null). `venues`/`tvs` are admin-write under RLS, so the delete
// runs with the service role, gated by an app-layer ownership check.
//
// Blocked while a PAID advertiser ad is live on the screen: we don't drop a
// paying advertiser silently — the host has to contact us first.
export async function removeLocation(venueId: string) {
  const profile = await requireProfile()
  const admin = createAdminClient()

  const { data: venue } = await admin
    .from('venues')
    .select('id, host_user_id, tvs(id)')
    .eq('id', venueId)
    .maybeSingle()
  if (!venue) return { error: 'Location not found.' }
  if (profile.role !== 'admin' && venue.host_user_id !== profile.id) {
    return { error: 'That location is not on your account.' }
  }

  // Refuse if any paid advertiser ad is currently running on this location's
  // screen(s). The host's own free promos (owner_kind 'host') don't count.
  const tvIds = ((venue.tvs ?? []) as { id: string }[]).map((t) => t.id)
  if (tvIds.length) {
    const { data: placements } = await admin
      .from('ad_placements')
      .select('id, ad:ads(owner_kind)')
      .in('tv_id', tvIds)
      .eq('status', 'active')
    const paid = (placements ?? []).filter((p) => {
      const ad = Array.isArray(p.ad) ? p.ad[0] : p.ad
      return ad?.owner_kind === 'advertiser'
    })
    if (paid.length) {
      return {
        error: `This location has ${paid.length} paid ad${
          paid.length === 1 ? '' : 's'
        } running. Contact us to remove it.`,
      }
    }
  }

  const { error } = await admin.from('venues').delete().eq('id', venueId)
  if (error) return { error: error.message }

  revalidatePath('/host')
  return { error: null as string | null }
}
