'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { activatePlacementsIfReady } from '@/lib/placement'

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
