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
import { CREATIVE_SETUP_FEE_CENTS, CREATIVE_REFRESH_CENTS } from '@/lib/fees'

export interface NewCampaignInput {
  territory_id: string
  venue_ids: string[] // the cart — screens the advertiser picked off the map
  category_id: string | null
  title: string
  qr_target_url: string | null
  creative_type: 'video' | 'image' | null
  creative_url: string | null
  creative_help_brief: string | null
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
  if (!input.territory_id) return { error: 'Pick a market.' }

  const venueIds = [...new Set((input.venue_ids ?? []).filter(Boolean))]
  if (!venueIds.length) return { error: 'Your cart is empty — pick at least one screen.' }

  // Authoritative re-price from the DB (never trust a client total). Volume,
  // host (20%), and loyalty discounts + free-screen credits are applied here
  // from the buyer's standing, not the client.
  const ctx = await resolveAdvertiserContext(profile.id)
  const { totalCents, tiers, quote } = await resolveCartCents(venueIds, contextToQuoteOptions(ctx))
  if (!tiers.length) return { error: 'None of the selected screens are available anymore.' }

  const supabase = await createClient()

  const { data: ad, error: adErr } = await supabase
    .from('ads')
    .insert({
      owner_user_id: profile.id,
      owner_kind: 'advertiser',
      territory_id: input.territory_id,
      category_id: input.category_id,
      title: input.title.trim(),
      creative_type: input.creative_type ?? 'image',
      creative_url: input.creative_url,
      status: 'pending',
      qr_target_url: input.qr_target_url || null,
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
      territory_id: input.territory_id,
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
      territory_id: input.territory_id,
      status: 'incomplete',
    })
    .select('id')
    .single()

  const screenLabel = `${quote.totalScreens} screen${quote.totalScreens === 1 ? '' : 's'}`

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
              product_data: { name: `Loop Network — ${screenLabel}` },
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
                    product_data: { name: 'Loop Network — Creative refresh' },
                  },
                },
                {
                  quantity: 1,
                  price_data: {
                    currency: 'usd',
                    unit_amount: CREATIVE_SETUP_FEE_CENTS,
                    product_data: { name: 'Loop Network — Creative setup (one-time)' },
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
        success_url: `${base}/advertiser/campaigns/${campaign.id}?checkout=success`,
        cancel_url: `${base}/advertiser/campaigns/${campaign.id}?checkout=canceled`,
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
  revalidatePath('/advertiser')
  return { campaignId: campaign.id, demo: true }
}
