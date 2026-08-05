// Billing for screens on a LIVE campaign.
//
// Adding a screen is gated on payment: the server action stages the request and
// sends the advertiser to Checkout, and applyScreenAdd runs from the Stripe
// webhook once the session is paid. Nothing about the campaign changes until
// then — no targets, no placements, no new monthly total.
//
// Server-only (service-role admin client + Stripe secret key).

import { createAdminClient } from '@/lib/supabase/admin'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { activatePlacementsIfReady } from '@/lib/placement'
import { CREATIVE_REFRESH_CENTS } from '@/lib/fees'

type Admin = ReturnType<typeof createAdminClient>

// Move the subscription onto a new monthly screen total. Returns what it was on
// before (for rollback) and the proration invoice, if the change raised one.
// Throws — callers surface the failure instead of swallowing it.
export async function repriceScreens(
  subId: string,
  totalCents: number,
  proration: Stripe.SubscriptionUpdateParams.ProrationBehavior
): Promise<{ previousCents: number | null; invoiceId?: string }> {
  const sub = await stripe().subscriptions.retrieve(subId)
  // With a creative-refresh add-on there are 2 recurring items; the screens item
  // is the one that isn't the $20 refresh.
  const recurring = sub.items.data.filter((i) => i.price.recurring)
  const item =
    recurring.length <= 1
      ? (recurring[0] ?? sub.items.data[0])
      : (recurring.find((i) => i.price.unit_amount !== CREATIVE_REFRESH_CENTS) ?? recurring[0])
  if (!item) throw new Error('no billing plan on this subscription')

  const product = typeof item.price.product === 'string' ? item.price.product : item.price.product.id
  const updated = await stripe().subscriptions.update(subId, {
    items: [
      {
        id: item.id,
        price_data: {
          currency: 'usd',
          product,
          unit_amount: totalCents,
          recurring: { interval: 'month' },
        },
      },
    ],
    proration_behavior: proration,
  })
  const inv = updated.latest_invoice
  return {
    previousCents: item.price.unit_amount,
    invoiceId: typeof inv === 'string' ? inv : inv?.id,
  }
}

// Apply a paid (or waived) screen-add request: attach the venues, move the
// subscription onto the new monthly total, and place the ad. Idempotent — a row
// already 'applied' is a no-op, so a Stripe webhook retry can't double-apply.
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
  if (venueIds.length) {
    // Net-new only — PK is (campaign_id, venue_id), so a retry can't duplicate.
    await admin
      .from('campaign_targets')
      .upsert(
        venueIds.map((venue_id) => ({ campaign_id: req.campaign_id, venue_id })),
        { onConflict: 'campaign_id,venue_id', ignoreDuplicates: true }
      )
  }

  // The increase for the rest of this cycle was already collected at Checkout, so
  // move the recurring rate WITHOUT proration — otherwise Stripe would bill for
  // the same period a second time on the next invoice.
  const { data: sub } = await admin
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('campaign_id', req.campaign_id)
    .maybeSingle()
  if (sub?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
    try {
      await repriceScreens(sub.stripe_subscription_id, req.new_monthly_cents, 'none')
    } catch {
      // The advertiser has paid and the screens are going live either way. Only
      // the recurring rate is at stake here and an admin can correct it in
      // Stripe, so this must not throw — a non-2xx would make the webhook retry
      // and re-place everything.
    }
  }

  // monthly_total_cents is action-owned everywhere else; this is the one path
  // where the webhook owns it, because the action deliberately changed nothing.
  await admin
    .from('campaigns')
    .update({ monthly_total_cents: req.new_monthly_cents })
    .eq('id', req.campaign_id)

  // Place only the newly-added venues' screens (placeCampaign skips existing TVs).
  await activatePlacementsIfReady(req.campaign_id, admin)

  await admin
    .from('screen_add_requests')
    .update({ status: 'applied', applied_at: new Date().toISOString() })
    .eq('id', req.id)

  return { ok: true, campaignId: req.campaign_id }
}
