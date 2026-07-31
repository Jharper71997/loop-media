// Applies a PAID screen add: the advertiser has paid the increase, so the venues
// join the campaign, the subscription moves to the new monthly total, and the ad
// places onto the new screens. Idempotent — a row already 'applied' is a no-op, so
// a Stripe webhook retry can't double-add screens or double-move the subscription.
//
// Server-only (service-role admin client).

import { createAdminClient } from '@/lib/supabase/admin'
import { activatePlacementsIfReady } from '@/lib/placement'
import { setSubscriptionMonthlyCents } from '@/lib/stripeSubscription'

type Admin = ReturnType<typeof createAdminClient>

export async function applyScreenAdd(
  admin: Admin,
  requestId: string
): Promise<{ ok: boolean; campaignId?: string }> {
  const { data: req } = await admin
    .from('screen_add_requests')
    .select('id, campaign_id, venue_ids, new_monthly_cents, status')
    .eq('id', requestId)
    .maybeSingle()
  if (!req) return { ok: false }
  if (req.status === 'applied') return { ok: true, campaignId: req.campaign_id }

  const venueIds = (req.venue_ids ?? []) as string[]

  // The cart IS the placement target set, so targets go in first. Ignore conflicts
  // rather than failing the whole apply: the buyer has already paid, and a venue
  // that arrived on the campaign by another route in the meantime is not an error.
  if (venueIds.length) {
    await admin.from('campaign_targets').upsert(
      venueIds.map((venue_id) => ({ campaign_id: req.campaign_id, venue_id })),
      { onConflict: 'campaign_id,venue_id', ignoreDuplicates: true }
    )
  }

  // Ongoing rate. NO proration — the increase was charged in full at checkout, so
  // prorating it again here would bill for the same screens twice.
  const { data: subRow } = await admin
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('campaign_id', req.campaign_id)
    .maybeSingle()
  if (subRow?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
    try {
      await setSubscriptionMonthlyCents(
        subRow.stripe_subscription_id,
        req.new_monthly_cents,
        'none'
      )
    } catch (e) {
      // They HAVE paid for this add, so never withhold the screens over a Stripe
      // hiccup — but leave a loud trail, because the recurring amount is now stale
      // and an admin has to reconcile it in Stripe.
      console.error(
        '[screen-add] subscription amount update FAILED — campaign',
        req.campaign_id,
        'should now bill',
        req.new_monthly_cents,
        'cents/mo:',
        e
      )
    }
  }

  await admin
    .from('campaigns')
    .update({ monthly_total_cents: req.new_monthly_cents })
    .eq('id', req.campaign_id)

  await admin
    .from('screen_add_requests')
    .update({ status: 'applied', applied_at: new Date().toISOString() })
    .eq('id', req.id)

  // Fill the newly-added venues' screens (placeCampaign skips TVs already running
  // this campaign, so existing screens are untouched).
  await activatePlacementsIfReady(req.campaign_id, admin)

  return { ok: true, campaignId: req.campaign_id }
}
