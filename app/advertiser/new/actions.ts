'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile } from '@/lib/auth'
import { stripe, appUrl } from '@/lib/stripe'
import {
  resolveCartCents,
  resolveAdvertiserContext,
  contextToQuoteOptions,
  getPricingConfig,
} from '@/lib/pricing.server'
import { venueExclusivityCents } from '@/lib/pricing'
import { activatePlacementsIfReady } from '@/lib/placement'
import {
  venuesWithActiveExclusive,
  availableExclusiveVenueIds,
  activateExclusiveSlots,
} from '@/lib/exclusivity'
import { notifyCampaignCreated } from '@/lib/notifyAdvertiser'
import { notifyAdminNewAd } from '@/lib/notifyAdmin'
import { CREATIVE_SETUP_FEE_CENTS, CREATIVE_REFRESH_CENTS } from '@/lib/fees'
import { hostCompCodeForUser, hostCompPromotionId, HOST_COMP_MAX_SCREENS } from '@/lib/hostComp'
import { QR_SIZE_DEFAULT, isOwnCreativeUrl, clampSpotSeconds } from '@/lib/adCreative'

export interface NewCampaignInput {
  territory_id: string
  venue_ids: string[] // the cart — screens the advertiser picked off the map
  // Subset of venue_ids the buyer is paying to own their category at (exclusivity).
  exclusive_venue_ids?: string[]
  category_id: string | null
  title: string
  qr_target_url: string | null
  // Free-drag QR center as fractions [0,1] of the 16:9 frame (default ~ bottom-right).
  qr_x?: number
  qr_y?: number
  // QR width as a fraction of the frame width (default QR_SIZE_DEFAULT).
  qr_size?: number
  creative_type: 'video' | 'image' | null
  creative_url: string | null
  // Real clip length read off the uploaded video in the browser. Advisory — the
  // server clamps it into the sold slot before it reaches the insert, so a crafted
  // request can't buy itself extra airtime. Null (images, or an unreadable file)
  // falls back to the full slot.
  duration_seconds?: number | null
  creative_help_brief: string | null
  // Which app tree the buyer is in, so post-checkout returns to the right place.
  // Hosts advertise from '/host/advertise'; everyone else from '/advertiser'.
  base_path?: string
}

export interface SubmitResult {
  error?: string
  checkoutUrl?: string
  campaignId?: string
  demo?: boolean
  freeWeek?: boolean
}

export async function submitCampaign(input: NewCampaignInput): Promise<SubmitResult> {
  const profile = await requireProfile()
  // Advertisers, admins (testing), and hosts (advertising elsewhere) can buy.
  if (!['advertiser', 'admin', 'host'].includes(profile.role)) {
    return { error: 'You are not able to create campaigns.' }
  }
  const isAdmin = profile.role === 'admin'
  // Demo advertiser: everything runs for real up to payment, but no Stripe charge
  // and — critically — the ad is NEVER placed on a real screen (see the branch at
  // the end + the is_demo guard in the placement engine/cron). Flags on the ad +
  // campaign keep it out of admin review, revenue, and the buy map.
  const isDemo = profile.is_demo
  if (!input.title.trim()) return { error: 'Give your ad a title.' }
  if (!input.qr_target_url?.trim()) return { error: 'Add a scan link for your ad.' }
  if (!input.territory_id) return { error: 'Pick a market.' }
  // A creative (when provided — the "make it for me" path submits none) must be a
  // file we host in the buyer's own storage folder, never an external URL that
  // could be swapped after review. See isOwnCreativeUrl.
  if (input.creative_url && !isOwnCreativeUrl(input.creative_url, profile.id)) {
    return { error: 'We could not verify that creative. Upload your image or video again.' }
  }

  let venueIds = [...new Set((input.venue_ids ?? []).filter(Boolean))]
  if (!venueIds.length) return { error: 'Your cart is empty. Pick at least one screen.' }

  const supabase = await createClient()

  // Exclusivity guard (defense-in-depth; the browse map already grays these out):
  // a venue never runs an ad in its OWN line of business. Drop any picked venue
  // whose category matches this ad's category.
  if (input.category_id) {
    const { data: vCats } = await supabase
      .from('venues')
      .select('id, category_id, host_user_id')
      .in('id', venueIds)
    // Block same-category venues this buyer does NOT own (competitors), but let
    // the venue's own owner promote themselves on their own screen.
    const blocked = new Set(
      (vCats ?? [])
        .filter((v) => v.category_id === input.category_id && v.host_user_id !== profile.id)
        .map((v) => v.id)
    )
    venueIds = venueIds.filter((id) => !blocked.has(id))
    if (!venueIds.length) {
      return { error: "Those screens are in your own line of business, so competitors can't advertise there. Pick different screens." }
    }
  }

  // Authoritative market from the picked venues (the client value only labels the
  // campaign; a bogus territory_id would pollute revenue-by-territory). Placement
  // uses the cart, not this field, so deriving it is safe.
  const { data: vTerr } = await supabase
    .from('venues')
    .select('territory_id')
    .in('id', venueIds)
  const territoryId = vTerr?.find((v) => v.territory_id)?.territory_id ?? input.territory_id

  // Paid exclusivity (server-authoritative; the client toggle is only a hint).
  // 1) Never place where a COMPETITOR already owns the category exclusively.
  // 2) Only sell exclusivity where it's actually available (no competitor active,
  //    not already taken) — a slot that filled since page load is silently dropped.
  const admin = createAdminClient()
  let exclusiveIds: string[] = []
  if (input.category_id) {
    const foreign = await venuesWithActiveExclusive(admin, input.category_id, venueIds)
    const blockedByExclusive = new Set(
      [...foreign.entries()].filter(([, adv]) => adv !== profile.id).map(([vid]) => vid)
    )
    venueIds = venueIds.filter((id) => !blockedByExclusive.has(id))
    if (!venueIds.length) {
      return {
        error:
          'Those screens are owned exclusively by another advertiser in your category. Pick different screens.',
      }
    }
    const requested = [...new Set((input.exclusive_venue_ids ?? []).filter(Boolean))].filter((id) =>
      venueIds.includes(id)
    )
    if (requested.length) {
      const available = await availableExclusiveVenueIds(
        admin,
        input.category_id,
        profile.id,
        requested
      )
      exclusiveIds = requested.filter((id) => available.has(id))
    }
  }

  // Authoritative re-price from the DB (never trust a client total). Volume,
  // host (20%), and loyalty discounts + free-screen credits are applied here
  // from the buyer's standing, not the client. Exclusivity upcharges add on top.
  const ctx = await resolveAdvertiserContext(profile.id)
  const { totalCents, screenCents, quote } = await resolveCartCents(
    venueIds,
    contextToQuoteOptions(ctx),
    exclusiveIds
  )
  if (!screenCents.length) return { error: 'None of the selected screens are available anymore.' }

  const { data: ad, error: adErr } = await supabase
    .from('ads')
    .insert({
      owner_user_id: profile.id,
      owner_kind: 'advertiser',
      territory_id: territoryId,
      category_id: input.category_id,
      title: input.title.trim(),
      creative_type: input.creative_type ?? 'image',
      creative_url: input.creative_url,
      // Clamped server-side: never trust a client-reported length, and never let an
      // ad claim more of the loop than the slot it paid for.
      duration_seconds: clampSpotSeconds(input.duration_seconds ?? 0),
      // Demo ads are auto-approved (they're never reviewed and never air).
      status: isDemo ? 'approved' : 'pending',
      is_demo: isDemo,
      qr_target_url: input.qr_target_url.trim(),
      qr_x: input.qr_x ?? 0.9,
      qr_y: input.qr_y ?? 0.88,
      qr_size: input.qr_size ?? QR_SIZE_DEFAULT,
    })
    .select('id')
    .single()
  if (adErr || !ad) return { error: adErr?.message ?? 'Could not create ad.' }

  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .insert({
      advertiser_id: profile.id,
      ad_id: ad.id,
      package_id: null,
      territory_id: territoryId,
      monthly_total_cents: totalCents,
      status: 'draft',
      is_demo: isDemo,
    })
    .select('id')
    .single()
  if (cErr || !campaign) return { error: cErr?.message ?? 'Could not create campaign.' }

  // The cart IS the placement target set.
  await supabase
    .from('campaign_targets')
    .insert(venueIds.map((venue_id) => ({ campaign_id: campaign.id, venue_id })))

  // Stage bought exclusivity as PENDING; payment confirmation (webhook / demo
  // path) flips it to active. Pending blocks nothing, so an abandoned checkout
  // leaves no live exclusive behind.
  if (exclusiveIds.length && input.category_id) {
    const config = await getPricingConfig()
    const { data: exVenues } = await supabase
      .from('venues')
      .select('id, exclusivity_price_cents')
      .in('id', exclusiveIds)
    const priceByVenue = new Map<string, number>()
    for (const v of (exVenues ?? []) as { id: string; exclusivity_price_cents: number | null }[]) {
      priceByVenue.set(v.id, venueExclusivityCents(v.exclusivity_price_cents, config))
    }
    await admin.from('exclusive_slots').insert(
      exclusiveIds.map((venue_id) => ({
        venue_id,
        category_id: input.category_id,
        campaign_id: campaign.id,
        advertiser_id: profile.id,
        territory_id: territoryId,
        status: 'pending',
        price_cents: priceByVenue.get(venue_id) ?? null,
      }))
    )
  }

  if (input.creative_help_brief?.trim()) {
    await supabase
      .from('creative_requests')
      .insert({ advertiser_id: profile.id, brief: input.creative_help_brief.trim() })
  }

  const { data: sub } = await supabase
    .from('subscriptions')
    .insert({
      advertiser_id: profile.id,
      campaign_id: campaign.id,
      package_id: null,
      territory_id: territoryId,
      status: 'incomplete',
    })
    .select('id')
    .single()

  // Confirmation email — "your campaign is set up, here's what happens next".
  // Best-effort: a mail hiccup must never block campaign creation or checkout.
  // Skipped for demo (the address is synthetic and there's nothing to confirm).
  if (!isDemo) {
    try {
      await notifyCampaignCreated(campaign.id)
    } catch {
      /* swallow — never fail creation on a notification error */
    }
    // Heads-up to the network admins that a new ad is waiting in the review queue.
    try {
      await notifyAdminNewAd(ad.id)
    } catch {
      /* swallow — never fail creation on a notification error */
    }
  }

  const screenLabel = `${quote.totalScreens} screen${quote.totalScreens === 1 ? '' : 's'}`
  // Return the buyer to the tree they bought from. Whitelisted to avoid an
  // open-redirect via a crafted base_path.
  const pathPrefix = input.base_path === '/host/advertise' ? '/host/advertise' : '/advertiser'
  const homePath = pathPrefix === '/host/advertise' ? '/host' : '/advertiser'

  // Free-week credit: an admin granted this advertiser a comp before they built
  // anything. Skip payment entirely and run the ad FREE for 7 days (comp_until;
  // the place cron auto-stops it), then consume the credit. The ad still goes
  // through review before it airs. Never for admin/demo paths. Defensive read so a
  // pre-migration DB (no free_week_credit column) simply falls through to checkout.
  if (!isAdmin && !isDemo) {
    let hasFreeWeek = false
    try {
      const { data: p } = await admin
        .from('profiles')
        .select('free_week_credit')
        .eq('id', profile.id)
        .maybeSingle()
      hasFreeWeek = !!(p as { free_week_credit?: boolean } | null)?.free_week_credit
    } catch {
      hasFreeWeek = false
    }
    if (hasFreeWeek) {
      const compUntil = new Date(Date.now() + 7 * 86400000).toISOString()
      await admin.from('campaigns').update({ status: 'active', comp_until: compUntil }).eq('id', campaign.id)
      await admin.from('profiles').update({ free_week_credit: false }).eq('id', profile.id)
      if (sub?.id) {
        await admin
          .from('subscriptions')
          .update({ status: 'active', current_period_end: compUntil })
          .eq('id', sub.id)
      }
      // No-op until the ad clears review; approveAd then places it for the week.
      await activatePlacementsIfReady(campaign.id, admin)
      revalidatePath(homePath)
      return { campaignId: campaign.id, freeWeek: true }
    }
  }

  // Real Stripe Checkout when configured; admins + demo always skip live payment.
  if (process.env.STRIPE_SECRET_KEY && !isAdmin && !isDemo) {
    try {
      const base = appUrl()
      const wantsCreative = !!input.creative_help_brief?.trim()

      // Host perk, applied for them. A live host has a 100%-off comp code minted
      // when their venue went active; they used to have to remember it and type it
      // into Stripe. Resolve it here and attach it to the session instead. Stripe
      // rejects `discounts` alongside `allow_promotion_codes`, so it's one or the
      // other — a host without a usable code still gets the manual box.
      //
      // Only up to HOST_COMP_MAX_SCREENS. The coupon is 100% off the ENTIRE order,
      // so auto-applying it to a big cart would quietly comp every screen in it
      // against a perk that promises two. Over the cap we apply nothing and leave
      // the manual box — same as before this existed.
      const hostDiscountId =
        profile.role === 'host' && quote.totalScreens <= HOST_COMP_MAX_SCREENS
          ? await hostCompPromotionId(await hostCompCodeForUser(admin, profile.id))
          : null

      const session = await stripe().checkout.sessions.create({
        mode: 'subscription',
        ...(hostDiscountId
          ? { discounts: [{ promotion_code: hostDiscountId }] }
          : { allow_promotion_codes: true }),
        customer_email: profile.email,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: totalCents,
              recurring: { interval: 'month' },
              product_data: { name: `Loop Network: ${screenLabel}` },
            },
          },
          ...(wantsCreative
            ? [
                {
                  quantity: 1,
                  price_data: {
                    currency: 'usd',
                    unit_amount: CREATIVE_REFRESH_CENTS,
                    recurring: { interval: 'month' as const },
                    product_data: { name: 'Loop Network: Creative refresh' },
                  },
                },
                {
                  quantity: 1,
                  price_data: {
                    currency: 'usd',
                    unit_amount: CREATIVE_SETUP_FEE_CENTS,
                    product_data: { name: 'Loop Network: Creative setup (one-time)' },
                  },
                },
              ]
            : []),
        ],
        metadata: {
          campaign_id: campaign.id,
          subscription_id: sub?.id ?? '',
          advertiser_id: profile.id,
        },
        success_url: `${base}${pathPrefix}/campaigns/${campaign.id}?checkout=success`,
        cancel_url: `${base}${pathPrefix}/campaigns/${campaign.id}?checkout=canceled`,
      })
      return { checkoutUrl: session.url ?? undefined, campaignId: campaign.id }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Stripe checkout failed.' }
    }
  }

  // Demo / admin: no live charge — activate immediately.
  await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
    })
    .eq('id', sub?.id ?? '')
  await supabase.from('campaigns').update({ status: 'active' }).eq('id', campaign.id)
  // The demo campaign shows as "active" and its picked screens render on the
  // dashboard from campaign_targets — but we DELIBERATELY do not place it, so no
  // ad ever airs on a real TV. (The placement engine + cron also refuse is_demo
  // campaigns as a backstop.) A real admin test still places for QA.
  if (!isDemo) {
    await activatePlacementsIfReady(campaign.id)
    await activateExclusiveSlots(admin, campaign.id)
  }
  revalidatePath(homePath)
  return { campaignId: campaign.id, demo: true }
}
