// Applies a staged creative change to its ad: point the ad at the new creative
// and send it back to review ('pending'). The TV loop only plays approved/active
// ads, so the unreviewed creative never reaches a screen; once an admin approves,
// the campaign's existing placements resume with the new spot. Idempotent: a row
// already 'applied' is a no-op (so a Stripe webhook retry can't double-apply).
//
// Server-only (service-role admin client).

import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export async function applyAdChange(
  admin: Admin,
  changeId: string
): Promise<{ ok: boolean; campaignId?: string }> {
  const { data: change } = await admin
    .from('ad_change_requests')
    .select('id, ad_id, campaign_id, creative_url, creative_type, status')
    .eq('id', changeId)
    .maybeSingle()
  if (!change) return { ok: false }
  if (change.status === 'applied') return { ok: true, campaignId: change.campaign_id }

  await admin
    .from('ads')
    .update({
      creative_url: change.creative_url,
      creative_type: change.creative_type,
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      rejection_reason: null,
    })
    .eq('id', change.ad_id)

  await admin
    .from('ad_change_requests')
    .update({ status: 'applied', applied_at: new Date().toISOString() })
    .eq('id', change.id)

  return { ok: true, campaignId: change.campaign_id }
}
