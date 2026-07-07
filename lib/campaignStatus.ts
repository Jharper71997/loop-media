// Shared campaign status transitions for the dunning path (Stripe webhook). These
// run with the service-role admin client (no user session), mirroring the
// advertiser pause/resume actions but callable from the webhook. Server-only.

import { createAdminClient } from '@/lib/supabase/admin'
import { activatePlacementsIfReady } from '@/lib/placement'
import { releaseExclusiveSlots, reactivateExclusiveSlots } from '@/lib/exclusivity'

type Admin = ReturnType<typeof createAdminClient>

// Dunning: stop a campaign's ad from running when its payment fails, so a
// non-paying advertiser doesn't keep playing free through Stripe's retry window.
// Leaves a canceled/trashed campaign alone, and only pauses an ad that was actually
// live (approved/active) — a still-pending or rejected ad keeps its review status.
export async function pauseCampaignForNonpayment(admin: Admin, campaignId: string): Promise<void> {
  const { data: c } = await admin
    .from('campaigns')
    .select('id, ad_id, status')
    .eq('id', campaignId)
    .maybeSingle()
  if (!c || c.status === 'canceled') return

  await admin.from('campaigns').update({ status: 'paused' }).eq('id', campaignId)
  if (c.ad_id) {
    await admin
      .from('ads')
      .update({ status: 'paused' })
      .eq('id', c.ad_id)
      .in('status', ['approved', 'active'])
  }
  await admin
    .from('ad_placements')
    .update({ status: 'paused' })
    .eq('campaign_id', campaignId)
    .eq('status', 'active')
  // A non-paying advertiser shouldn't keep holding an exclusive slot — free it.
  await releaseExclusiveSlots(admin, campaignId)
}

// Recovery: bring a campaign that was paused for non-payment back after a
// successful (retry) charge. Only revives a 'paused' campaign — never a
// canceled/trashed one — and only re-approves an ad WE paused (so a pending ad
// never bypasses review). No-op for a campaign that's already active.
export async function resumeCampaignAfterPayment(admin: Admin, campaignId: string): Promise<void> {
  const { data: c } = await admin
    .from('campaigns')
    .select('id, ad_id, status')
    .eq('id', campaignId)
    .maybeSingle()
  if (!c || c.status !== 'paused') return

  await admin.from('campaigns').update({ status: 'active' }).eq('id', campaignId)
  if (c.ad_id) {
    await admin
      .from('ads')
      .update({ status: 'approved' })
      .eq('id', c.ad_id)
      .eq('status', 'paused')
  }
  await admin
    .from('ad_placements')
    .update({ status: 'active' })
    .eq('campaign_id', campaignId)
    .eq('status', 'paused')

  // If nothing came back active (e.g. never placed), fill now.
  const { count } = await admin
    .from('ad_placements')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'active')
  if (!count) await activatePlacementsIfReady(campaignId, admin)

  // Best-effort: re-take any exclusive slots freed while it was paused (skipped
  // for any a competitor grabbed in the meantime).
  await reactivateExclusiveSlots(admin, campaignId)
}
