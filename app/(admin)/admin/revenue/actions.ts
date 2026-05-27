'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { activatePlacementsIfReady } from '@/lib/placement'

// Safety net for when the Stripe webhook didn't fire (e.g. STRIPE_WEBHOOK_SECRET
// unset): manually mark a campaign's subscription paid, activate the campaign, and
// place it onto screens (no-ops on placement until the ad is approved). Same end
// state the webhook would have produced.
export async function markCampaignPaid(campaignId: string) {
  await requireAdmin()
  const admin = createAdminClient()

  const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString()
  await admin
    .from('subscriptions')
    .update({ status: 'active', current_period_end: periodEnd })
    .eq('campaign_id', campaignId)
  await admin.from('campaigns').update({ status: 'active' }).eq('id', campaignId)
  await activatePlacementsIfReady(campaignId, admin)

  revalidatePath('/admin/revenue')
  return { error: null }
}
