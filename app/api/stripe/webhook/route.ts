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

  // Idempotency: Stripe re-sends events on any non-2xx (and occasionally on
  // success). Claim the event id first; if it's already recorded, this is a
  // replay -> no-op. If processing throws below, we delete the claim so Stripe's
  // retry actually reprocesses.
  const { error: claimErr } = await supabase
    .from('processed_stripe_events')
    .insert({ event_id: event.id, type: event.type })
  if (claimErr) {
    // Unique-violation = already processed. Anything else, fail so Stripe retries.
    if (claimErr.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    return NextResponse.json({ error: 'dedupe store failed' }, { status: 500 })
  }

  try {
    await handleEvent(event, supabase)
  } catch (err) {
    // Release the claim so the retry reprocesses, then signal failure to Stripe.
    await supabase.from('processed_stripe_events').delete().eq('event_id', event.id)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'handler failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({ received: true })
}

async function handleEvent(
  event: Stripe.Event,
  supabase: ReturnType<typeof createAdminClient>
): Promise<void> {
  const now = new Date().toISOString()

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session

    // Only act on a session that actually paid. Without this, an unpaid/abandoned
    // or test session could flip campaigns/memberships to active.
    if (s.payment_status !== 'paid') return

    // Paid ad change ($10 one-time): apply the staged creative now that it's paid.
    const adChangeId = s.metadata?.ad_change_id
    if (adChangeId) {
      await applyAdChange(supabase, adChangeId)
      return
    }

    // Unlimited-changes membership purchase: activate the membership row, but
    // refuse to create a SECOND active membership (= double $29/mo billing) —
    // cancel the duplicate Stripe subscription instead.
    const membershipId = s.metadata?.membership_id
    if (membershipId) {
      const subId = typeof s.subscription === 'string' ? s.subscription : null
      const { data: m } = await supabase
        .from('memberships')
        .select('advertiser_id, kind')
        .eq('id', membershipId)
        .maybeSingle()
      if (!m) return
      const { data: existing } = await supabase
        .from('memberships')
        .select('id')
        .eq('advertiser_id', m.advertiser_id)
        .eq('kind', m.kind)
        .eq('status', 'active')
        .neq('id', membershipId)
        .limit(1)
      if (existing && existing.length) {
        if (subId) {
          try {
            await stripe().subscriptions.cancel(subId)
          } catch {
            /* best-effort cancel of the duplicate */
          }
        }
        await supabase
          .from('memberships')
          .update({ status: 'canceled', updated_at: now })
          .eq('id', membershipId)
        return
      }
      await supabase
        .from('memberships')
        .update({
          status: 'active',
          stripe_subscription_id: subId,
          stripe_customer_id: typeof s.customer === 'string' ? s.customer : null,
          updated_at: now,
        })
        .eq('id', membershipId)
      return
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
      .update({ status: 'canceled', updated_at: now })
      .eq('stripe_subscription_id', sub.id)
  }
}
