'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'
import { stripe, appUrl } from '@/lib/stripe'
import {
  resolveCartCents,
  resolveAdvertiserContext,
  contextToQuoteOptions,
} from '@/lib/pricing.server'
import { activatePlacementsIfReady } from '@/lib/placement'
import { notifyCampaignCreated } from '@/lib/notifyAdvertiser'
import { CREATIVE_SETUP_FEE_CENTS, CREATIVE_REFRESH_CENTS } from '@/lib/fees'

export interface NewCampaignInput {
  territory_id: string
  venue_ids: string[] // the cart — screens the advertiser picked off the map
  category_id: string | null
  title: string
  qr_target_url: string | null
  // Free-drag QR center as fractions [0,1] of the 16:9 frame (default ~ bottom-right).
  qr_x?: number
  qr_y?: number
  creative_type: 'video' | 'image' | null
  creative_url: string | null
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
}

export async function submitCampaign(input: NewCampaignInput): Promise<SubmitResult> {
  const profile = await requireProfile()
  // Advertisers, admins (testing), and hosts (advertising elsewhere) can buy.
  if (!['advertiser', 'admin', 'host'].includes(profile.role)) {
    return { error: 'You are not able to create campaigns.' }
  }
  const isAdmin = profile.role === 'admin'
  if (!input.title.trim()) return { error: 'Give your ad a title.' }
  if (!input.qr_target_url?.trim()) return { error: 'Add a scan link for your ad.' }
  if (!input.territory_id) return { error: 'Pick a market.' }

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

  // Authoritative re-price from the DB (never trust a client total). Volume,
  // host (20%), and loyalty discounts + free-screen credits are applied here
  // from the buyer's standing, not the client.
  const ctx = await resolveAdvertiserContext(profile.id)
  const { totalCents, tiers, quote } = await resolveCartCents(venueIds, contextToQuoteOptions(ctx))
  if (!tiers.length) return { error: 'None of the selected screens are available anymore.' }

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
      status: 'pending',
      qr_target_url: input.qr_target_url.trim(),
      qr_x: input.qr_x ?? 0.9,
      qr_y: input.qr_y ?? 0.88,
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
    })
    .select('id')
    .single()
  if (cErr || !campaign) return { error: cErr?.message ?? 'Could not create campaign.' }

  // The cart IS the placement target set.
  await supabase
    .from('campaign_targets')
    .insert(venueIds.map((venue_id) => ({ campaign_id: campaign.id, venue_id })))

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
  // Fires for both the Stripe and demo paths since it sits before the branch.
  // Best-effort: a mail hiccup must never block campaign creation or checkout.
  try {
    await notifyCampaignCreated(campaign.id)
  } catch {
    /* swallow — never fail creation on a notification error */
  }

  const screenLabel = `${quote.totalScreens} screen${quote.totalScreens === 1 ? '' : 's'}`
  // Return the buyer to the tree they bought from. Whitelisted to avoid an
  // open-redirect via a crafted base_path.
  const pathPrefix = input.base_path === '/host/advertise' ? '/host/advertise' : '/advertiser'
  const homePath = pathPrefix === '/host/advertise' ? '/host' : '/advertiser'

  // Real Stripe Checkout when configured; admins always skip live payment.
  if (process.env.STRIPE_SECRET_KEY && !isAdmin) {
    try {
      const base = appUrl()
      const wantsCreative = !!input.creative_help_brief?.trim()
      const session = await stripe().checkout.sessions.create({
        mode: 'subscription',
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
  await activatePlacementsIfReady(campaign.id)
  revalidatePath(homePath)
  return { campaignId: campaign.id, demo: true }
}
