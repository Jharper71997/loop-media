'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin, adminCanTerritory } from '@/lib/auth'
import { moveCampaignScreen, type MoveResult } from '@/lib/moveScreen'

// Admin-side entry point for moving a campaign off one venue's screens and onto
// another's. The rules live in lib/moveScreen; this only authorizes the caller
// and refreshes what the move made stale.

export async function moveScreen(
  campaignId: string,
  fromVenueId: string,
  toVenueId: string,
  acceptDeltaCents: number
): Promise<MoveResult> {
  const profile = await requireAdmin()
  const supabase = await createClient()

  // campaigns/placements are admin-write under RLS with no territory scope, so
  // the market check happens here — against the campaign, not the venue picked.
  const { data: camp } = await supabase
    .from('campaigns')
    .select('territory_id')
    .eq('id', campaignId)
    .maybeSingle()
  if (!camp) return { error: 'Campaign not found.' }
  if (!adminCanTerritory(profile, camp.territory_id)) {
    return { error: 'Not allowed for your territory.' }
  }

  const res = await moveCampaignScreen(campaignId, fromVenueId, toVenueId, acceptDeltaCents)
  if (res.error) return res

  // Both venues, the campaign, and every case list that counts dark screens or
  // money at risk are now wrong until they re-read.
  revalidatePath('/admin')
  revalidatePath('/admin/uptime')
  revalidatePath('/admin/venues')
  revalidatePath(`/admin/venues/${fromVenueId}`)
  revalidatePath(`/admin/venues/${toVenueId}`)
  return res
}
