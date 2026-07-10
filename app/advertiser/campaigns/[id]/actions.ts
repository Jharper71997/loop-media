'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile } from '@/lib/auth'
import { stripe, appUrl } from '@/lib/stripe'
import { activatePlacementsIfReady } from '@/lib/placement'
import { hasUnlimitedChanges, hasInsightsMembership } from '@/lib/membership'
import { applyAdChange } from '@/lib/adChanges'
import { isOwnCreativeUrl } from '@/lib/adCreative'
import {
  AD_CHANGE_FEE_CENTS,
  AD_CHANGE_FREE_EVERY_DAYS,
  UNLIMITED_CHANGES_CENTS,
  INSIGHTS_CENTS,
  CREATIVE_REFRESH_CENTS,
} from '@/lib/fees'
import {
  resolveCartCents,
  resolveAdvertiserContext,
  contextToQuoteOptions,
} from '@/lib/pricing.server'
import {
  campaignExclusiveVenueIds,
  releaseExclusiveSlots,
  reactivateExclusiveSlots,
} from '@/lib/exclusivity'

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
  await releaseExclusiveSlots(admin, id)

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
  // A pause for NON-PAYMENT (dunning sets the sub 'past_due') can't be cleared for
  // free from here — that would run the ad through the rest of the retry window
  // unpaid. The advertiser must fix payment; invoice.paid then auto-resumes it.
  const { data: subRow } = await admin
    .from('subscriptions')
    .select('status')
    .eq('campaign_id', id)
    .maybeSingle()
  if (subRow?.status === 'past_due') {
    return {
      error:
        'Your last payment did not go through. Update your payment method and the ad resumes automatically.',
    }
  }
  await admin.from('campaigns').update({ status: 'active' }).eq('id', id)
  // Only re-approve an ad WE paused — never push a still-pending or rejected ad live.
  if (c.ad_id)
    await admin.from('ads').update({ status: 'approved' }).eq('id', c.ad_id).eq('status', 'paused')
  await admin.from('ad_placements').update({ status: 'active' }).eq('campaign_id', id).eq('status', 'paused')
  await admin.from('subscriptions').update({ status: 'active' }).eq('campaign_id', id)

  // If resuming left it with no live screens (never placed, or all ended), fill now.
  const { count } = await admin
    .from('ad_placements')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', id)
    .eq('status', 'active')
  if (!count) await activatePlacementsIfReady(id, admin)
  await reactivateExclusiveSlots(admin, id)

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
  await releaseExclusiveSlots(admin, id)

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
  await releaseExclusiveSlots(admin, id)

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
  await releaseExclusiveSlots(admin, id)

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

// Re-open Stripe Checkout for a DRAFT campaign whose buyer abandoned or failed
// payment. The campaign + subscription rows already exist from submitCampaign, so
// this just mints a fresh Checkout session — no rebuild, no re-pick of venues. The
// webhook flips it to active on payment exactly like a brand-new campaign. Without
// this, a "saved as draft — resume payment anytime" campaign was a dead end.
export async function resumeCheckout(
  id: string,
  basePath?: string
): Promise<{ error?: string; checkoutUrl?: string }> {
  const profile = await requireProfile()
  const supabase = await createClient()
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, advertiser_id, status, monthly_total_cents')
    .eq('id', id)
    .maybeSingle()
  if (!campaign || campaign.advertiser_id !== profile.id) return { error: 'Campaign not found.' }
  if (campaign.status === 'active') return { error: 'This campaign is already live.' }
  if (campaign.status === 'canceled')
    return { error: 'This campaign was canceled. Start a new one.' }
  if (!campaign.monthly_total_cents || campaign.monthly_total_cents <= 0)
    return { error: 'This campaign has no amount to charge.' }
  if (!process.env.STRIPE_SECRET_KEY) return { error: 'Payments are not configured.' }

  const admin = createAdminClient()
  const { data: sub } = await admin
    .from('subscriptions')
    .select('id')
    .eq('campaign_id', id)
    .maybeSingle()

  const base = appUrl()
  // Return the buyer to the tree they bought from (host vs advertiser shell).
  const pathPrefix = basePath === '/host/advertise' ? '/host/advertise' : '/advertiser'
  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      allow_promotion_codes: true,
      customer_email: profile.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: campaign.monthly_total_cents,
            recurring: { interval: 'month' },
            product_data: { name: 'Loop Network: monthly ad placement' },
          },
        },
      ],
      metadata: {
        campaign_id: campaign.id,
        subscription_id: sub?.id ?? '',
        advertiser_id: profile.id,
      },
      success_url: `${base}${pathPrefix}/campaigns/${campaign.id}?checkout=success`,
      cancel_url: `${base}${pathPrefix}/campaigns/${campaign.id}?checkout=canceled`,
    })
    return { checkoutUrl: session.url ?? undefined }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Stripe checkout failed.' }
  }
}

// Relaunch a CANCELED (or restored-from-Trash) campaign. Cancel/trash/archive
// cancels the Stripe subscription outright, so the old billing is dead — bringing
// the ad back requires a NEW payment, not a resume. This mints a fresh monthly
// subscription Checkout for the frozen total; the webhook flips the campaign +
// subscription back to active and re-places the ad on payment. Because the cancel
// paused the ad, we clear that here so the placement engine (which only runs an
// APPROVED ad) fires the moment payment lands. Demo/no-Stripe relaunches for free.
export async function relaunchCampaign(
  id: string,
  basePath?: string
): Promise<{ error?: string; checkoutUrl?: string; demo?: boolean }> {
  const owned = await ownCampaign(id)
  if (!owned) return { error: 'Campaign not found.' }
  const profile = await requireProfile()
  const admin = createAdminClient()

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, status, monthly_total_cents, ad_id')
    .eq('id', id)
    .maybeSingle()
  if (!campaign) return { error: 'Campaign not found.' }
  if (campaign.status === 'active') return { error: 'This campaign is already live.' }
  if (!campaign.monthly_total_cents || campaign.monthly_total_cents <= 0)
    return { error: 'This campaign has no amount to charge. Start a new one.' }

  // A previously-approved ad was paused when the campaign was canceled; approve it
  // again so activatePlacementsIfReady runs after payment. Guarded to 'paused' so
  // a still-pending or rejected ad isn't silently pushed live.
  if (campaign.ad_id)
    await admin
      .from('ads')
      .update({ status: 'approved' })
      .eq('id', campaign.ad_id)
      .eq('status', 'paused')

  // Demo / no-Stripe: relaunch immediately with no charge (mirrors submitCampaign).
  if (!process.env.STRIPE_SECRET_KEY) {
    await admin.from('campaigns').update({ status: 'active' }).eq('id', id)
    await admin.from('subscriptions').update({ status: 'active' }).eq('campaign_id', id)
    await activatePlacementsIfReady(id, admin)
    // Re-take any exclusivity the campaign held before it was canceled (its slots
    // were released on cancel). The Stripe path does this in the webhook on payment.
    await reactivateExclusiveSlots(admin, id)
    revalidate(id)
    return { demo: true }
  }

  const { data: sub } = await admin
    .from('subscriptions')
    .select('id')
    .eq('campaign_id', id)
    .maybeSingle()

  const base = appUrl()
  const pathPrefix = basePath === '/host/advertise' ? '/host/advertise' : '/advertiser'
  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      allow_promotion_codes: true,
      customer_email: profile.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: campaign.monthly_total_cents,
            recurring: { interval: 'month' },
            product_data: { name: 'Loop Network: monthly ad placement' },
          },
        },
      ],
      metadata: {
        campaign_id: campaign.id,
        subscription_id: sub?.id ?? '',
        advertiser_id: profile.id,
      },
      success_url: `${base}${pathPrefix}/campaigns/${campaign.id}?checkout=success`,
      cancel_url: `${base}${pathPrefix}/campaigns/${campaign.id}?checkout=canceled`,
    })
    return { checkoutUrl: session.url ?? undefined }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Stripe checkout failed.' }
  }
}

// Swap the creative on an existing campaign. The new file is uploaded client-side
// to the `creatives` bucket; here we route it through the ad-change policy:
//
//   * Members (active unlimited-changes membership) and demo/no-Stripe setups:
//     the change is applied for free immediately. The ad goes back to review
//     ('pending'); the TV loop only plays approved ads, so the unreviewed
//     creative never reaches a screen, and placements + billing stay untouched.
//   * Everyone else: the FIRST change each rolling 7 days is free (applied
//     immediately); any further change in that window is staged behind a $10
//     Checkout URL, and the Stripe webhook applies the creative once paid.
//
// Returns { applied } (live now) or { checkoutUrl } (pay first) or { error }.
export async function replaceCreative(
  id: string,
  creativeUrl: string,
  creativeType: 'image' | 'video',
  basePath?: string
): Promise<{ error?: string; applied?: boolean; checkoutUrl?: string }> {
  if (!creativeUrl) return { error: 'No creative was uploaded.' }
  const c = await ownCampaign(id)
  if (!c) return { error: 'Campaign not found.' }
  if (!c.ad_id) return { error: 'This campaign has no ad to replace yet.' }

  const admin = createAdminClient()
  const profile = await requireProfile()
  // The swapped-in creative must be a file we host in this advertiser's own
  // storage folder — never an external URL. This is what makes "even when
  // swapped, re-review it" airtight: applyAdChange already flips the ad back to
  // 'pending', and forcing our-storage-only means the file itself can't be
  // silently changed afterward to dodge that review. See isOwnCreativeUrl.
  if (!isOwnCreativeUrl(creativeUrl, profile.id)) {
    return { error: 'We could not verify that creative. Upload your file again.' }
  }
  // Fee policy: members (unlimited-changes membership) and demo/no-Stripe setups
  // are always free. Everyone else gets ONE free change per rolling 7 days; a
  // further change in that window pays the $10 fee at Checkout. "Used" = a change
  // that actually went live (status 'applied') within the window — staged-but-
  // abandoned or canceled changes don't burn the free one.
  const isMember = await hasUnlimitedChanges(admin, profile.id)
  const noStripe = !process.env.STRIPE_SECRET_KEY
  let usedFreeThisWeek = false
  if (!isMember && !noStripe) {
    const since = new Date(
      Date.now() - AD_CHANGE_FREE_EVERY_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()
    const { count } = await admin
      .from('ad_change_requests')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'applied')
      .gte('applied_at', since)
    usedFreeThisWeek = (count ?? 0) > 0
  }
  const free = isMember || noStripe || !usedFreeThisWeek

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
      success_url: `${base}${basePath === '/host/advertise' ? '/host/advertise' : '/advertiser'}/campaigns/${id}?change=success`,
      cancel_url: `${base}${basePath === '/host/advertise' ? '/host/advertise' : '/advertiser'}/campaigns/${id}?change=canceled`,
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
export async function startMembershipCheckout(basePath?: string): Promise<{
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
      allow_promotion_codes: true,
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
      success_url: `${base}${basePath === '/host/advertise' ? '/host' : '/advertiser'}?membership=success`,
      cancel_url: `${base}${basePath === '/host/advertise' ? '/host' : '/advertiser'}?membership=canceled`,
    })
    return { checkoutUrl: session.url ?? undefined }
  } catch (e) {
    await admin.from('memberships').update({ status: 'canceled' }).eq('id', membership.id)
    return { error: e instanceof Error ? e.message : 'Could not start checkout.' }
  }
}

// Start the Insights membership ($X/mo) — the tier that unlocks QR scan analytics
// across the advertiser's dashboard, results, and monthly report. Mirrors the
// unlimited-changes flow: create a draft membership row + a subscription Checkout;
// the webhook (membership_id metadata) activates it on payment and refuses a
// duplicate active membership. The moment it's active, hasInsightsMembership() is
// true and every gated scan number lights up — no other wiring needed.
export async function startInsightsCheckout(basePath?: string): Promise<{
  error?: string
  checkoutUrl?: string
}> {
  const profile = await requireProfile()
  const admin = createAdminClient()

  // Already a member? Nothing to buy.
  if (await hasInsightsMembership(admin, profile.id)) {
    return { error: 'You already have Loop Insights.' }
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return { error: 'Payments are not configured.' }
  }

  const { data: membership, error: insErr } = await admin
    .from('memberships')
    .insert({ advertiser_id: profile.id, kind: 'insights', status: 'incomplete' })
    .select('id')
    .single()
  if (insErr || !membership) return { error: 'Could not start Insights. Try again.' }

  try {
    const base = appUrl()
    const home = basePath === '/host/advertise' ? '/host' : '/advertiser'
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      allow_promotion_codes: true,
      customer_email: profile.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: INSIGHTS_CENTS,
            recurring: { interval: 'month' },
            product_data: { name: 'Loop Network — Insights' },
          },
        },
      ],
      metadata: { membership_id: membership.id, advertiser_id: profile.id },
      success_url: `${base}${home}/results?insights=success`,
      cancel_url: `${base}${home}/results?insights=canceled`,
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
  // Keep any exclusivity upcharge the campaign already holds in the new total.
  const heldExclusives = await campaignExclusiveVenueIds(admin, id)
  const { totalCents, screenCents } = await resolveCartCents(
    union,
    contextToQuoteOptions(ctx),
    heldExclusives
  )
  if (!screenCents.length) return { error: 'Could not price those screens. Try again.' }

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

// Remove screens from an existing ACTIVE campaign, prorating the subscription DOWN.
// The removed screens' placements end and the lower monthly total prorates onto the
// next invoice as a Stripe CREDIT (policy: credit toward future billing, not a cash
// refund). At least one screen must remain — to drop them all, cancel the campaign.
export async function removeScreensFromCampaign(
  id: string,
  venueIds: string[]
): Promise<{ error?: string; removed?: number; newMonthlyCents?: number }> {
  const c = await ownCampaign(id)
  if (!c) return { error: 'Campaign not found.' }
  const ids = [...new Set((venueIds ?? []).filter(Boolean))]
  if (!ids.length) return { error: 'Pick at least one screen to remove.' }

  const admin = createAdminClient()
  const advertiserId = c.advertiser_id

  const { data: camp } = await admin.from('campaigns').select('status').eq('id', id).maybeSingle()
  if (!camp) return { error: 'Campaign not found.' }
  if (camp.status !== 'active') return { error: 'Only an active campaign can change screens.' }

  const { data: existingTargets } = await admin
    .from('campaign_targets')
    .select('venue_id')
    .eq('campaign_id', id)
  const existingVenueIds = (existingTargets ?? []).map((t) => t.venue_id as string)
  const existingSet = new Set(existingVenueIds)
  const toRemove = ids.filter((v) => existingSet.has(v))
  if (!toRemove.length) return { error: 'None of those screens are on this campaign.' }

  const remaining = existingVenueIds.filter((v) => !toRemove.includes(v))
  if (!remaining.length) {
    return { error: 'That would remove every screen. Cancel the campaign instead.' }
  }

  // Re-price the REDUCED set (discounts/floor are non-linear, so re-price the whole
  // remaining union — don't subtract incrementally). Exclusivity upcharges follow
  // the screens: a removed venue's exclusive is dropped from the total (and freed).
  const ctx = await resolveAdvertiserContext(advertiserId)
  const heldExclusives = await campaignExclusiveVenueIds(admin, id)
  const remainingExclusives = heldExclusives.filter((v) => !toRemove.includes(v))
  const { totalCents, screenCents } = await resolveCartCents(
    remaining,
    contextToQuoteOptions(ctx),
    remainingExclusives
  )
  if (!screenCents.length) return { error: 'Could not re-price the campaign. Try again.' }

  // Drop the targets and end any live placements on the removed venues' screens.
  await admin.from('campaign_targets').delete().eq('campaign_id', id).in('venue_id', toRemove)
  // Free any exclusivity held at the removed venues.
  await releaseExclusiveSlots(admin, id, toRemove)
  const { data: removedTvs } = await admin.from('tvs').select('id').in('venue_id', toRemove)
  const removedTvIds = (removedTvs ?? []).map((t) => t.id as string)
  if (removedTvIds.length) {
    await admin
      .from('ad_placements')
      .update({ status: 'ended' })
      .eq('campaign_id', id)
      .in('tv_id', removedTvIds)
  }

  // Lower the Stripe subscription amount, prorated (a credit on the next invoice).
  const subId = await stripeSubId(admin, id)
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      const sub = await stripe().subscriptions.retrieve(subId)
      const recurring = sub.items.data.filter((i) => i.price.recurring)
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

  await admin.from('campaigns').update({ monthly_total_cents: totalCents }).eq('id', id)
  revalidate(id)
  return { removed: toRemove.length, newMonthlyCents: totalCents }
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
