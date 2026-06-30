'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, adminCanTerritory } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { activatePlacementsIfReady } from '@/lib/placement'
import { stripe } from '@/lib/stripe'

// Safety net for when the Stripe webhook didn't fire (e.g. STRIPE_WEBHOOK_SECRET
// unset): manually mark a campaign's subscription paid, activate the campaign, and
// place it onto screens (no-ops on placement until the ad is approved). Same end
// state the webhook would have produced.
//
// Audit hardening: (1) idempotent — no-op if already active, so it can't race the
// webhook into a double-activate; (2) if a Stripe subscription IS linked, verify
// it's really active/paid before activating (don't run ads for free on a misclick).
// Only the genuine no-Stripe-link fallback is an unverified admin override.
export async function markCampaignPaid(campaignId: string) {
  const profile = await requireAdmin()
  const admin = createAdminClient()

  const { data: campaign } = await admin
    .from('campaigns')
    .select('status, territory_id')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return { error: 'Campaign not found.' }
  // This activates + places via the service-role client (no RLS territory check),
  // so confine it to the caller's territory.
  if (!adminCanTerritory(profile, campaign.territory_id))
    return { error: 'Not allowed for your territory.' }
  if (campaign.status === 'active') return { error: null } // already done

  const { data: sub } = await admin
    .from('subscriptions')
    .select('id, stripe_subscription_id')
    .eq('campaign_id', campaignId)
    .maybeSingle()

  // If Stripe knows about this subscription, trust Stripe over the click.
  if (sub?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const live = await stripe().subscriptions.retrieve(sub.stripe_subscription_id)
      if (live.status !== 'active' && live.status !== 'trialing') {
        return { error: `Stripe shows this subscription as "${live.status}", not paid. Not activating.` }
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Could not verify the subscription with Stripe.' }
    }
  }

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
