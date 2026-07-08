'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin, isGlobalAdmin, adminCanTerritory } from '@/lib/auth'
import { activatePlacementsIfReady, placeCampaign } from '@/lib/placement'
import { notifyAdReviewed } from '@/lib/notifyAdvertiser'
import { stripe } from '@/lib/stripe'

function ok() {
  revalidatePath('/admin/advertisers', 'layout')
  return { error: null as string | null }
}

// Load a campaign for an admin lifecycle action and enforce territory scope.
// These actions write placements/ads/subscriptions through the SERVICE-ROLE
// client (those tables aren't admin-writable under normal RLS), which BYPASSES
// the RLS territory backstop — so the territory check has to happen here, in app
// code. Global admins pass; a city admin only acts within their own territory.
type AdminCampaign = {
  id: string
  ad_id: string | null
  territory_id: string | null
  advertiser_id: string
}
async function loadCampaignForAdmin(
  id: string
): Promise<
  { error: string } | { campaign: AdminCampaign; admin: ReturnType<typeof createAdminClient> }
> {
  const profile = await requireAdmin()
  const admin = createAdminClient()
  const { data } = await admin
    .from('campaigns')
    .select('id, ad_id, territory_id, advertiser_id')
    .eq('id', id)
    .maybeSingle()
  if (!data) return { error: 'Campaign not found.' }
  const campaign = data as AdminCampaign
  if (!adminCanTerritory(profile, campaign.territory_id))
    return { error: 'Not allowed for your territory.' }
  return { campaign, admin }
}

async function stripeSubId(admin: ReturnType<typeof createAdminClient>, campaignId: string) {
  const { data } = await admin
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('campaign_id', campaignId)
    .maybeSingle()
  return data?.stripe_subscription_id ?? null
}

// ---- ad review (mirrors admin/queue/actions.ts) ----
export async function approveAd(id: string) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('ads')
    .update({
      status: 'approved',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq('id', id)
  if (error) return { error: error.message }

  const admin = createAdminClient()
  const { data: campaigns } = await admin.from('campaigns').select('id').eq('ad_id', id)
  for (const c of campaigns ?? []) await activatePlacementsIfReady(c.id, admin)

  // Best-effort: tell the advertiser their ad cleared review (the queue does this
  // too — the admin-detail path was silently skipping it).
  try {
    await notifyAdReviewed(admin, id, { approved: true })
  } catch {
    /* a notification failure must never block approval */
  }
  return ok()
}

export async function rejectAd(id: string, reason: string) {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('ads')
    .update({
      status: 'rejected',
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason || 'Not specified',
    })
    .eq('id', id)
  if (error) return { error: error.message }

  // End any active placements so the rejected creative leaves the loop AND frees
  // its slot (otherwise the placement row keeps the slot counted against other
  // advertisers). Mirrors admin/queue/actions.ts:rejectAd.
  const admin = createAdminClient()
  await admin
    .from('ad_placements')
    .update({ status: 'ended', end_date: new Date().toISOString().slice(0, 10) })
    .eq('ad_id', id)
    .eq('status', 'active')

  // Best-effort: tell the advertiser what to fix so they can resubmit.
  try {
    await notifyAdReviewed(admin, id, { approved: false, reason })
  } catch {
    /* a notification failure must never block rejection */
  }
  return ok()
}

// ---- campaign lifecycle (full cascade — mirrors advertiser/campaigns/[id]) ----
// Each of these stops/starts the AD on screens and the STRIPE billing, not just
// the campaign status label. The old versions only flipped campaigns.status, so
// "Cancel" left the ad playing and the subscription billing.
export async function pauseCampaign(id: string) {
  const r = await loadCampaignForAdmin(id)
  if ('error' in r) return { error: r.error }
  const { campaign: c, admin } = r
  await admin.from('campaigns').update({ status: 'paused' }).eq('id', id)
  if (c.ad_id) await admin.from('ads').update({ status: 'paused' }).eq('id', c.ad_id)
  await admin
    .from('ad_placements')
    .update({ status: 'paused' })
    .eq('campaign_id', id)
    .eq('status', 'active')
  await admin.from('subscriptions').update({ status: 'paused' }).eq('campaign_id', id)

  const subId = await stripeSubId(admin, id)
  if (subId && process.env.STRIPE_SECRET_KEY) {
    try {
      await stripe().subscriptions.update(subId, { pause_collection: { behavior: 'void' } })
    } catch {
      /* best effort */
    }
  }
  return ok()
}

export async function resumeCampaign(id: string) {
  const r = await loadCampaignForAdmin(id)
  if ('error' in r) return { error: r.error }
  const { campaign: c, admin } = r
  await admin.from('campaigns').update({ status: 'active' }).eq('id', id)
  if (c.ad_id) await admin.from('ads').update({ status: 'approved' }).eq('id', c.ad_id)
  await admin
    .from('ad_placements')
    .update({ status: 'active' })
    .eq('campaign_id', id)
    .eq('status', 'paused')
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
  return ok()
}

export async function cancelCampaign(id: string) {
  const r = await loadCampaignForAdmin(id)
  if ('error' in r) return { error: r.error }
  const { campaign: c, admin } = r
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
  return ok()
}

// ---- campaign tuning (RLS-scoped via createClient — territory-safe as-is) ----
export async function setCampaignGoal(id: string, value: number | null) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('campaigns')
    .update({ target_impressions: value ?? 0 })
    .eq('id', id)
  if (error) return { error: error.message }
  return ok()
}

export async function setCampaignScreenCap(id: string, value: number | null) {
  await requireAdmin()
  const supabase = await createClient()
  const { error } = await supabase
    .from('campaigns')
    .update({ screen_cap_override: value })
    .eq('id', id)
  if (error) return { error: error.message }
  return ok()
}

// Manually re-run the placement engine for one campaign (fills toward goal/cap).
export async function rerunPlacement(id: string) {
  const r = await loadCampaignForAdmin(id)
  if ('error' in r) return { error: r.error }
  const res = await placeCampaign(id, r.admin)
  revalidatePath('/admin/advertisers', 'layout')
  if (!res.ok) return { error: res.reason ?? 'Placement failed.' }
  return { error: null as string | null, created: res.created, screens: res.screens }
}

// ---- advertiser profile ----
export async function updateAdvertiserProfile(
  id: string,
  input: { full_name: string; phone: string; territory_id: string | null }
) {
  const profile = await requireAdmin()
  const supabase = await createClient()

  // profiles RLS is plain is_admin() (any admin), so confine edits to advertisers
  // in the caller's territory here.
  const { data: target } = await supabase
    .from('profiles')
    .select('territory_id')
    .eq('id', id)
    .maybeSingle()
  if (!target) return { error: 'Advertiser not found.' }
  if (!adminCanTerritory(profile, target.territory_id))
    return { error: 'Not allowed for your territory.' }

  // Only a global (Holdings) admin may move someone between territories. A city
  // admin can NEVER change territory_id — including on their own row, where
  // setting it null would self-promote to a global admin.
  const territory_id = isGlobalAdmin(profile) ? input.territory_id : target.territory_id

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: input.full_name.trim() || null,
      phone: input.phone.trim() || null,
      territory_id,
    })
    .eq('id', id)
  if (error) return { error: error.message }
  return ok()
}

// Permanently delete an advertiser account. Hard-deletes the auth user, which
// cascades their profile → ads → campaigns → subscriptions → ad_placements →
// targets (FK ON DELETE CASCADE). Any venue they HOST survives with host_user_id
// nulled; payment/credit history is kept (advertiser_id nulled). Their EMAIL is
// freed, so the person can sign up fresh as an advertiser OR a host.
//
// The one thing a DB cascade can't stop is Stripe billing, so we cancel every
// subscription first — otherwise the card keeps getting charged after the row is
// gone. Territory-guarded; a city admin can only delete advertisers in their city.
export async function deleteAdvertiser(id: string) {
  const profile = await requireAdmin()
  if (id === profile.id) return { error: 'You can’t delete your own account here.' }

  const admin = createAdminClient()

  // Confirm the target is an advertiser in this admin's territory before touching
  // anything (profiles RLS is any-admin, so scope it here — same as the edit action).
  const { data: target } = await admin
    .from('profiles')
    .select('role, territory_id')
    .eq('id', id)
    .maybeSingle()
  if (!target) return { error: 'Advertiser not found.' }
  if (target.role !== 'advertiser')
    return { error: 'This account is not an advertiser — delete it from its own page.' }
  if (!adminCanTerritory(profile, target.territory_id))
    return { error: 'Not allowed for your territory.' }

  // Cancel Stripe billing first (best-effort per sub — a Stripe hiccup must not
  // leave the account half-deleted, and an already-canceled sub is fine to skip).
  if (process.env.STRIPE_SECRET_KEY) {
    const { data: subs } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('advertiser_id', id)
    for (const s of subs ?? []) {
      if (!s.stripe_subscription_id) continue
      try {
        await stripe().subscriptions.cancel(s.stripe_subscription_id)
      } catch {
        /* already canceled / not found — keep going */
      }
    }
  }

  // Hard-delete the auth user (shouldSoftDelete defaults false), which cascades the
  // profile and all owned rows and frees the email for a fresh signup.
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return { error: error.message }

  revalidatePath('/admin/advertisers', 'layout')
  return { error: null as string | null }
}
