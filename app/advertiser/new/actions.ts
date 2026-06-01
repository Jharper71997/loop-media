'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth'
import { stripe, appUrl } from '@/lib/stripe'
import { resolvePriceCents } from '@/lib/pricing'
import { activatePlacementsIfReady } from '@/lib/placement'

export interface NewCampaignInput {
  territory_id: string
  package_id: string | null
  package_label: string
  target_impressions: number
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
  // Advertisers create campaigns normally; admins may create them too (for
  // testing) and skip live payment — see the Stripe gate below.
  if (profile.role !== 'advertiser' && profile.role !== 'admin') {
    return { error: 'Only advertisers can create campaigns.' }
  }
  const isAdmin = profile.role === 'admin'
  if (!input.title.trim()) return { error: 'Give your ad a title.' }
  if (!input.territory_id) return { error: 'Pick a market.' }

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
      package_id: input.package_id,
      territory_id: input.territory_id,
      target_impressions: input.target_impressions,
      status: 'draft',
    })
    .select('id')
    .single()
  if (cErr || !campaign) return { error: cErr?.message ?? 'Could not create campaign.' }

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
      package_id: input.package_id,
      territory_id: input.territory_id,
      status: 'incomplete',
    })
    .select('id')
    .single()

  const priceCents = await resolvePriceCents(
    input.package_id,
    input.territory_id,
    input.target_impressions
  )

  // Real Stripe Checkout when configured; otherwise demo-activate so the flow
  // is fully testable without payment keys. Admins always skip payment (internal
  // testing) so they're never charged on the live keys.
  if (process.env.STRIPE_SECRET_KEY && !isAdmin) {
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
              unit_amount: priceCents,
              recurring: { interval: 'month' },
              product_data: { name: `Loop Media — ${input.package_label}` },
            },
          },
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

  // Demo mode: no Stripe key — activate immediately.
  await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
    })
    .eq('id', sub?.id ?? '')
  await supabase.from('campaigns').update({ status: 'active' }).eq('id', campaign.id)
  // Ad is still pending review, so this no-ops until an admin approves it.
  await activatePlacementsIfReady(campaign.id)
  revalidatePath('/advertiser')
  return { campaignId: campaign.id, demo: true }
}
