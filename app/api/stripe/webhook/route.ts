import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { activatePlacementsIfReady } from '@/lib/placement'
import { applyAdChange } from '@/lib/adChanges'

function mapSubStatus(sub: Stripe.Subscription): string {
  return sub.pause_collection
    ? 'paused'
    : sub.status === 'active'
      ? 'active'
      : sub.status === 'past_due'
        ? 'past_due'
        : 'incomplete'
}

// Stripe sends events here. Verifies the signature, then syncs subscription +
// campaign state. Runs with the service-role client (no user session).
export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!sig || !secret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 400 })
  }

  const body = await req.text()
  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(body, sig, secret)
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${err instanceof Error ? err.message : ''}` },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session

    // Paid ad change ($10 one-time): apply the staged creative now that it's paid.
    const adChangeId = s.metadata?.ad_change_id
    if (adChangeId) {
      const { campaignId: changeCampaign } = await applyAdChange(supabase, adChangeId)
      if (changeCampaign) {
        return NextResponse.json({ received: true })
      }
    }

    // Unlimited-changes membership purchase: activate the membership row.
    const membershipId = s.metadata?.membership_id
    if (membershipId) {
      await supabase
        .from('memberships')
        .update({
          status: 'active',
          stripe_subscription_id: typeof s.subscription === 'string' ? s.subscription : null,
          stripe_customer_id: typeof s.customer === 'string' ? s.customer : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', membershipId)
      return NextResponse.json({ received: true })
    }

    const subscriptionId = s.metadata?.subscription_id
    const campaignId = s.metadata?.campaign_id
    if (subscriptionId) {
      await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          stripe_subscription_id: typeof s.subscription === 'string' ? s.subscription : null,
          stripe_customer_id: typeof s.customer === 'string' ? s.customer : null,
        })
        .eq('id', subscriptionId)
    }
    if (campaignId) {
      await supabase.from('campaigns').update({ status: 'active' }).eq('id', campaignId)
      // Place onto screens if the ad is already approved (else admin approval will).
      await activatePlacementsIfReady(campaignId, supabase)
    }
  } else if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription
    const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end
    const status = mapSubStatus(sub)
    const periodEndIso = periodEnd ? new Date(periodEnd * 1000).toISOString() : null
    // A given Stripe subscription id is either a campaign subscription or a
    // membership; updating both by id is safe (only one matches).
    await supabase
      .from('subscriptions')
      .update({ status, current_period_end: periodEndIso })
      .eq('stripe_subscription_id', sub.id)
    await supabase
      .from('memberships')
      .update({ status, current_period_end: periodEndIso, updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.id)
  } else if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const { data: row } = await supabase
      .from('subscriptions')
      .select('campaign_id')
      .eq('stripe_subscription_id', sub.id)
      .maybeSingle()
    await supabase
      .from('subscriptions')
      .update({ status: 'canceled' })
      .eq('stripe_subscription_id', sub.id)
    if (row?.campaign_id) {
      await supabase.from('campaigns').update({ status: 'canceled' }).eq('id', row.campaign_id)
    }
    // End a membership if that's what was canceled.
    await supabase
      .from('memberships')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.id)
  }

  return NextResponse.json({ received: true })
}
