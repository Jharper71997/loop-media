'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile } from '@/lib/auth'
import { stripe, appUrl } from '@/lib/stripe'
import { activatePlacementsIfReady } from '@/lib/placement'
import { hasUnlimitedChanges } from '@/lib/membership'
import { applyAdChange } from '@/lib/adChanges'
import { AD_CHANGE_FEE_CENTS, UNLIMITED_CHANGES_CENTS, CREATIVE_REFRESH_CENTS } from '@/lib/fees'
import {
  resolveCartCents,
  resolveAdvertiserContext,
  contextToQuoteOptions,
} from '@/lib/pricing.server'

// Verify the signed-in advertiser owns this campaign, then mutate via service
// role (placements/subscriptions aren't writable under the advertiser's RLS).
async function ownCampaign(id: string) {
  const profile = await requireProfile()
  const supabase = await createClient()
  const { data } = await supabase
    .from('campaigns')
    .select('id, advertiser_id, ad_id')
    .eq('id', id)
    .maybeSingle()
  if (!data || data.advertiser_id !== profile.id) return null
  return data as { id: string; advertiser_id: string; ad_id: string | null }
}

async function stripeSubId(admin: ReturnType<typeof createAdminClient>, campaignId: string) {
  const { data } = await admin
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('campaign_id', campaignId)
    .maybeSingle()
  return data?.stripe_subscription_id ?? null
}

function revalidate(id: string) {
  revalidatePath(`/advertiser/campaigns/${id}`)
  revalidatePath('/advertiser')
}

export async function pauseCampaign(id: string) {
  const c = await ownCampaign(id)
  if (!c) return { error: 'Campaign not found.' }
  const admin = createAdminClient()
  await admin.from('campaigns').update({ status: 'paused' }).eq('id', id)
  if (c.ad_id) await admin.from('ads').update({ status: 'paused' }).eq('id', c.ad_id)
  await admin.from('ad_placements').update({ status: 'paused' }).eq('campaign_id', id).eq('status', 'active')
  await admin.from('subscriptions').update({ status: 'paused' }).eq('campaign_id', id)

  const subId = await stripeSubId(admin, id)
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      await stripe().subscriptions.update(subId, { pause_collection: { behavior: 'void' } })
    } catch {
      /* best effort */
    }
  }
  revalidate(id)
  return { error: null }
}

export async function resumeCampaign(id: string) {
  const c = await ownCampaign(id)
  if (!c) return { error: 'Campaign not found.' }
  const admin = createAdminClient()
  await admin.from('campaigns').update({ status: 'active' }).eq('id', id)
  if (c.ad_id) await admin.from('ads').update({ status: 'approved' }).eq('id', c.ad_id)
  await admin.from('ad_placements').update({ status: 'active' }).eq('campaign_id', id).eq('status', 'paused')
  await admin.from('subscriptions').update({ status: 'active' }).eq('campaign_id', id)

  // If resuming left it with no live screens (never placed, or all ended), fill now.
  const { count } = await admin
    .from('ad_placements')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', id)
    .eq('status', 'active')
  if (!count) await activatePlacementsIfReady(id, admin)

  const subId = await stripeSubId(admin, id)
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      await stripe().subscriptions.update(subId, { pause_collection: null })
    } catch {
      /* best effort */
    }
  }
  revalidate(id)
  return { error: null }
}

export async function cancelCampaign(id: string) {
  const c = await ownCampaign(id)
  if (!c) return { error: 'Campaign not found.' }
  const admin = createAdminClient()
  await admin.from('campaigns').update({ status: 'canceled' }).eq('id', id)
  if (c.ad_id) await admin.from('ads').update({ status: 'paused' }).eq('id', c.ad_id)
  await admin.from('ad_placements').update({ status: 'ended' }).eq('campaign_id', id)
  await admin.from('subscriptions').update({ status: 'canceled' }).eq('campaign_id', id)

  const subId = await stripeSubId(admin, id)
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      await stripe().subscriptions.cancel(subId)
    } catch {
      /* best effort */
    }
  }
  revalidate(id)
  return { error: null }
}

// Move a campaign to Trash: stop it running (and stop billing) exactly like a
// cancel, but flag deleted_at so it leaves the main list. Nothing is destroyed —
// the creative, targets and history stay and it can be restored.
export async function trashCampaign(id: string) {
  const c = await ownCampaign(id)
  if (!c) return { error: 'Campaign not found.' }
  const admin = createAdminClient()
  await admin
    .from('campaigns')
    .update({ status: 'canceled', deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (c.ad_id) await admin.from('ads').update({ status: 'paused' }).eq('id', c.ad_id)
  await admin.from('ad_placements').update({ status: 'ended' }).eq('campaign_id', id)
  await admin.from('subscriptions').update({ status: 'canceled' }).eq('campaign_id', id)

  const subId = await stripeSubId(admin, id)
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      await stripe().subscriptions.cancel(subId)
    } catch {
      /* best effort */
    }
  }
  revalidate(id)
  revalidatePath('/advertiser/trash')
  return { error: null }
}

// Archive: END the campaign (stop it running + billing, like cancel) and move
// it into "Past campaigns", where the advertiser reviews how it performed. The
// record, creative and history stay. Separate from Trash (delete/restore).
export async function archiveCampaign(id: string) {
  const c = await ownCampaign(id)
  if (!c) return { error: 'Campaign not found.' }
  const admin = createAdminClient()
  await admin
    .from('campaigns')
    .update({ status: 'canceled', archived_at: new Date().toISOString() })
    .eq('id', id)
  if (c.ad_id) await admin.from('ads').update({ status: 'paused' }).eq('id', c.ad_id)
  await admin.from('ad_placements').update({ status: 'ended' }).eq('campaign_id', id)
  await admin.from('subscriptions').update({ status: 'canceled' }).eq('campaign_id', id)

  const subId = await stripeSubId(admin, id)
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      await stripe().subscriptions.cancel(subId)
    } catch {
      /* best effort */
    }
  }
  revalidate(id)
  revalidatePath('/advertiser/past')
  return { error: null }
}

// Swap the creative on an existing campaign. The new file is uploaded client-side
// to the `creatives` bucket; here we route it through the ad-change policy:
//
//   * Members (active unlimited-changes membership) and demo/no-Stripe setups:
//     the change is applied for free immediately. The ad goes back to review
//     ('pending'); the TV loop only plays approved ads, so the unreviewed
//     creative never reaches a screen, and placements + billing stay untouched.
//   * Everyone else: stage the change and return a $10 Checkout URL. The Stripe
//     webhook applies the creative once the fee is paid.
//
// Returns { applied } (live now) or { checkoutUrl } (pay first) or { error }.
export async function replaceCreative(
  id: string,
  creativeUrl: string,
  creativeType: 'image' | 'video'
): Promise<{ error?: string; applied?: boolean; checkoutUrl?: string }> {
  if (!creativeUrl) return { error: 'No creative was uploaded.' }
  const c = await ownCampaign(id)
  if (!c) return { error: 'Campaign not found.' }
  if (!c.ad_id) return { error: 'This campaign has no ad to replace yet.' }

  const admin = createAdminClient()
  const profile = await requireProfile()
  const free = !process.env.STRIPE_SECRET_KEY || (await hasUnlimitedChanges(admin, profile.id))

  // Record the change either way (audit + the webhook needs the row to apply).
  const { data: change, error: insErr } = await admin
    .from('ad_change_requests')
    .insert({
      campaign_id: id,
      ad_id: c.ad_id,
      advertiser_id: profile.id,
      creative_url: creativeUrl,
      creative_type: creativeType,
      fee_cents: free ? 0 : AD_CHANGE_FEE_CENTS,
      status: free ? 'waived' : 'pending_payment',
    })
    .select('id')
    .single()
  if (insErr || !change) return { error: 'Could not start the change. Try again.' }

  if (free) {
    await applyAdChange(admin, change.id)
    revalidate(id)
    return { applied: true }
  }

  // Paid change: $10 one-time Checkout. Reuse the advertiser's existing Stripe
  // customer (from their campaign subscription) so the charge lands on file.
  try {
    const { data: subRow } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('campaign_id', id)
      .maybeSingle()
    const base = appUrl()
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      ...(subRow?.stripe_customer_id
        ? { customer: subRow.stripe_customer_id }
        : { customer_email: profile.email }),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: AD_CHANGE_FEE_CENTS,
            product_data: { name: 'Loop Network — Ad change' },
          },
        },
      ],
      metadata: { ad_change_id: change.id, campaign_id: id },
      success_url: `${base}/advertiser/campaigns/${id}?change=success`,
      cancel_url: `${base}/advertiser/campaigns/${id}?change=canceled`,
    })
    await admin
      .from('ad_change_requests')
      .update({ stripe_session_id: session.id })
      .eq('id', change.id)
    return { checkoutUrl: session.url ?? undefined }
  } catch (e) {
    await admin.from('ad_change_requests').update({ status: 'canceled' }).eq('id', change.id)
    return { error: e instanceof Error ? e.message : 'Could not start checkout.' }
  }
}

// Start the unlimited-changes membership ($X/mo). Creates a draft membership row
// + a subscription Checkout session; the webhook activates it on payment.
export async function startMembershipCheckout(): Promise<{
  error?: string
  checkoutUrl?: string
}> {
  const profile = await requireProfile()
  const admin = createAdminClient()

  // Already a member? Nothing to buy.
  if (await hasUnlimitedChanges(admin, profile.id)) {
    return { error: 'You already have the unlimited-changes membership.' }
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return { error: 'Payments are not configured.' }
  }

  const { data: membership, error: insErr } = await admin
    .from('memberships')
    .insert({ advertiser_id: profile.id, kind: 'unlimited_changes', status: 'incomplete' })
    .select('id')
    .single()
  if (insErr || !membership) return { error: 'Could not start membership. Try again.' }

  try {
    const base = appUrl()
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer_email: profile.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: UNLIMITED_CHANGES_CENTS,
            recurring: { interval: 'month' },
            product_data: { name: 'Loop Network — Unlimited ad changes' },
          },
        },
      ],
      metadata: { membership_id: membership.id, advertiser_id: profile.id },
      success_url: `${base}/advertiser?membership=success`,
      cancel_url: `${base}/advertiser?membership=canceled`,
    })
    return { checkoutUrl: session.url ?? undefined }
  } catch (e) {
    await admin.from('memberships').update({ status: 'canceled' }).eq('id', membership.id)
    return { error: e instanceof Error ? e.message : 'Could not start checkout.' }
  }
}

// Add more screens to an existing ACTIVE campaign, prorating the subscription —
// no new campaign, no fresh Checkout. The new screens join the same monthly
// subscription; the difference prorates onto the next invoice.
export async function addScreensToCampaign(
  id: string,
  venueIds: string[]
): Promise<{ error?: string; added?: number; newMonthlyCents?: number }> {
  const c = await ownCampaign(id)
  if (!c) return { error: 'Campaign not found.' }
  const ids = [...new Set((venueIds ?? []).filter(Boolean))]
  if (!ids.length) return { error: 'Pick at least one screen to add.' }

  const admin = createAdminClient()
  const advertiserId = c.advertiser_id

  // Must be live + paid to add to its subscription.
  const { data: camp } = await admin
    .from('campaigns')
    .select('status, territory_id')
    .eq('id', id)
    .maybeSingle()
  if (!camp) return { error: 'Campaign not found.' }
  if (camp.status !== 'active') return { error: 'Only an active campaign can take more screens.' }

  // The ad's category drives exclusivity (a competitor's own-category venue is blocked).
  let adCategory: string | null = null
  if (c.ad_id) {
    const { data: ad } = await admin
      .from('ads')
      .select('category_id')
      .eq('id', c.ad_id)
      .maybeSingle()
    adCategory = ad?.category_id ?? null
  }

  const { data: existingTargets } = await admin
    .from('campaign_targets')
    .select('venue_id')
    .eq('campaign_id', id)
  const existingVenueIds = (existingTargets ?? []).map((t) => t.venue_id as string)
  const existingSet = new Set(existingVenueIds)

  // Validate the incoming venues: active, same market as the campaign (the
  // placement engine only fills venues in the campaign's territory), not already
  // on it, and not blocked by category exclusivity.
  const { data: vRows } = await admin
    .from('venues')
    .select('id, status, territory_id, category_id, host_user_id')
    .in('id', ids)
  const toAdd = (vRows ?? [])
    .filter((v) => v.status === 'active')
    .filter((v) => v.territory_id === camp.territory_id)
    .filter((v) => !existingSet.has(v.id))
    .filter((v) => !(adCategory && v.category_id === adCategory && v.host_user_id !== advertiserId))
    .map((v) => v.id as string)
  if (!toAdd.length) return { error: 'None of those screens can be added to this campaign.' }

  // Re-price the WHOLE set (existing + new). Discounts/floor are non-linear, so
  // the new monthly total must be priced over the union, not added incrementally.
  const ctx = await resolveAdvertiserContext(advertiserId)
  const union = [...new Set([...existingVenueIds, ...toAdd])]
  const { totalCents, tiers } = await resolveCartCents(union, contextToQuoteOptions(ctx))
  if (!tiers.length) return { error: 'Could not price those screens. Try again.' }

  // Add the new targets (net-new only — PK is (campaign_id, venue_id)).
  const { error: tErr } = await admin
    .from('campaign_targets')
    .insert(toAdd.map((venue_id) => ({ campaign_id: id, venue_id })))
  if (tErr) return { error: 'Could not add those screens. Try again.' }

  // Bump the Stripe subscription amount, prorated. The monthly charge is a single
  // inline-price recurring item; swap it for a new inline price at the new total.
  const subId = await stripeSubId(admin, id)
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      const sub = await stripe().subscriptions.retrieve(subId)
      const recurring = sub.items.data.filter((i) => i.price.recurring)
      // With a creative-refresh add-on there are 2 recurring items; the screens
      // item is the one that isn't the $20 refresh.
      const item =
        recurring.length <= 1
          ? recurring[0] ?? sub.items.data[0]
          : recurring.find((i) => i.price.unit_amount !== CREATIVE_REFRESH_CENTS) ?? recurring[0]
      if (item) {
        const product =
          typeof item.price.product === 'string' ? item.price.product : item.price.product.id
        await stripe().subscriptions.update(subId, {
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
          proration_behavior: 'create_prorations',
        })
      }
    } catch {
      /* best effort — targets + total are saved; an admin can reconcile in Stripe */
    }
  }

  // monthly_total_cents is action-owned (the webhook never writes it).
  await admin.from('campaigns').update({ monthly_total_cents: totalCents }).eq('id', id)

  // Place only the newly-added venues' screens (placeCampaign skips existing TVs).
  await activatePlacementsIfReady(id, admin)

  revalidate(id)
  return { added: toAdd.length, newMonthlyCents: totalCents }
}

// Bring a campaign back from Trash. It returns to the list as canceled (billing
// stayed off) — the advertiser can relaunch it from there.
export async function restoreCampaign(id: string) {
  const c = await ownCampaign(id)
  if (!c) return { error: 'Campaign not found.' }
  const admin = createAdminClient()
  await admin.from('campaigns').update({ deleted_at: null }).eq('id', id)
  revalidate(id)
  revalidatePath('/advertiser/trash')
  return { error: null }
}
