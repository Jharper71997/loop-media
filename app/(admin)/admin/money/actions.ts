'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, adminCanTerritory } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { activatePlacementsIfReady } from '@/lib/placement'
import { addOneMonth } from '@/lib/billing'

// Money actions for accounts that don't bill themselves.
//
// Most of the network pays by check, by cash, or on a Stripe account this app
// doesn't own — none of which produce a webhook. Without these, an account that
// paid in December still reads "overdue" forever, and the only fix was editing
// rows in the Supabase dashboard.

function revalidate(advertiserId?: string) {
  revalidatePath('/admin')
  revalidatePath('/admin/money')
  revalidatePath('/admin/sell')
  if (advertiserId) revalidatePath(`/admin/advertisers/${advertiserId}`)
}

// Log money received against a campaign and push its paid-through date out.
// Writes to the SAME payments ledger the Stripe webhook uses, so "collected"
// means one thing everywhere.
export async function recordPayment(input: {
  campaignId: string
  amountCents: number
  paidAt: string
  paidThrough: string | null
  note?: string
}): Promise<{ error: string | null }> {
  const profile = await requireAdmin()
  const admin = createAdminClient()

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, advertiser_id, territory_id, status, comp_until')
    .eq('id', input.campaignId)
    .maybeSingle()
  if (!campaign) return { error: 'Campaign not found.' }
  const camp = campaign as {
    id: string
    advertiser_id: string
    territory_id: string
    status: string
    comp_until: string | null
  }
  if (!adminCanTerritory(profile, camp.territory_id)) {
    return { error: 'Not allowed for your territory.' }
  }
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    return { error: 'Enter the amount received.' }
  }

  const { error: payErr } = await admin.from('payments').insert({
    advertiser_id: camp.advertiser_id,
    campaign_id: camp.id,
    territory_id: camp.territory_id,
    source: 'check',
    amount_cents: Math.round(input.amountCents),
    paid_at: input.paidAt,
  })
  if (payErr) return { error: payErr.message }

  const periodEnd = input.paidThrough ?? addOneMonth(input.paidAt)

  // A paying account is not a comp. Clearing comp_until stops the nightly place
  // cron from pulling their ad down on the old comp date now that they're paying.
  await admin
    .from('campaigns')
    .update({ status: 'active', ...(camp.comp_until ? { comp_until: null } : {}) })
    .eq('id', camp.id)

  // Never 'canceled' — canceling wipes placement_snapshots, which is what this
  // advertiser's own report is built from. Reactivate and move the date.
  const { data: sub } = await admin
    .from('subscriptions')
    .select('id')
    .eq('campaign_id', camp.id)
    .maybeSingle()
  if (sub) {
    await admin
      .from('subscriptions')
      .update({ status: 'active', current_period_end: periodEnd })
      .eq('id', (sub as { id: string }).id)
  } else {
    await admin.from('subscriptions').insert({
      advertiser_id: camp.advertiser_id,
      campaign_id: camp.id,
      territory_id: camp.territory_id,
      status: 'active',
      current_period_end: periodEnd,
    })
  }

  // If the ad had come off screens, put it back.
  await activatePlacementsIfReady(camp.id, admin)

  revalidate(camp.advertiser_id)
  return { error: null }
}

// Push a comp out (or end it today). The nightly place cron reads comp_until and
// stops the ad on its own, so this is the whole mechanism.
export async function setCompUntil(
  campaignId: string,
  until: string | null
): Promise<{ error: string | null }> {
  const profile = await requireAdmin()
  const admin = createAdminClient()

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, advertiser_id, territory_id')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return { error: 'Campaign not found.' }
  const camp = campaign as { id: string; advertiser_id: string; territory_id: string }
  if (!adminCanTerritory(profile, camp.territory_id)) {
    return { error: 'Not allowed for your territory.' }
  }

  const { error } = await admin.from('campaigns').update({ comp_until: until }).eq('id', camp.id)
  if (error) return { error: error.message }

  if (until) {
    await admin
      .from('subscriptions')
      .update({ status: 'active', current_period_end: until })
      .eq('campaign_id', camp.id)
  }

  revalidate(camp.advertiser_id)
  return { error: null }
}

// Attach a subscription that is billed on another Stripe account, so the account
// reads as Stripe-billed and renews off the real period end instead of showing
// up as unbilled every month.
export async function linkStripeSubscription(
  campaignId: string,
  stripeSubscriptionId: string,
  currentPeriodEnd: string | null
): Promise<{ error: string | null }> {
  const profile = await requireAdmin()
  const admin = createAdminClient()

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, advertiser_id, territory_id')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign) return { error: 'Campaign not found.' }
  const camp = campaign as { id: string; advertiser_id: string; territory_id: string }
  if (!adminCanTerritory(profile, camp.territory_id)) {
    return { error: 'Not allowed for your territory.' }
  }
  const id = stripeSubscriptionId.trim()
  if (!id.startsWith('sub_')) return { error: 'A Stripe subscription ID starts with "sub_".' }

  const { data: sub } = await admin
    .from('subscriptions')
    .select('id')
    .eq('campaign_id', camp.id)
    .maybeSingle()
  const patch = {
    status: 'active' as const,
    stripe_subscription_id: id,
    current_period_end: currentPeriodEnd,
  }
  if (sub) {
    await admin.from('subscriptions').update(patch).eq('id', (sub as { id: string }).id)
  } else {
    await admin.from('subscriptions').insert({
      advertiser_id: camp.advertiser_id,
      campaign_id: camp.id,
      territory_id: camp.territory_id,
      ...patch,
    })
  }

  revalidate(camp.advertiser_id)
  return { error: null }
}
