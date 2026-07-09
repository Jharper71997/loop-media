'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile } from '@/lib/auth'
import { activatePlacementsIfReady } from '@/lib/placement'
import { getActiveOwnScreenPromos } from '@/lib/ownPromo'
import { QR_SIZE_DEFAULT } from '@/lib/adCreative'

export interface OwnPromoInput {
  venue_id: string
  title: string
  qr_target_url: string
  creative_type: 'video' | 'image' | null
  creative_url: string | null
  // Free-drag QR center + size as fractions of the 16:9 frame (defaults to the
  // bottom-right corner at the standard size when not positioned).
  qr_x?: number
  qr_y?: number
  qr_size?: number
}

export interface OwnPromoResult {
  error?: string
  ok?: boolean
}

// A host puts their OWN promo on their OWN screen, free. Auto-approved (it's their
// own screen and their own content) and placed immediately. All writes run with
// the service-role client AFTER we authorize the host — this is also what lets us
// set an approved/active status the ad-status lock (0035) blocks for signed-in
// non-admins, exactly like the placement engine and Stripe webhook do.
export async function submitOwnScreenPromo(input: OwnPromoInput): Promise<OwnPromoResult> {
  const profile = await requireProfile()
  if (!['host', 'admin'].includes(profile.role)) {
    return { error: 'Only hosts can put a promo on their own screen.' }
  }
  if (!input.title.trim()) return { error: 'Give your promo a title.' }
  if (!input.qr_target_url?.trim()) return { error: 'Add a scan link for your promo.' }
  if (!input.creative_url) return { error: 'Upload an image or video for your promo.' }
  if (!input.venue_id) return { error: 'Pick which of your screens this runs on.' }

  const admin = createAdminClient()

  // The venue must belong to THIS host, be live, and have a screen to run on.
  const { data: venue } = await admin
    .from('venues')
    .select('id, host_user_id, status, territory_id, tvs(id)')
    .eq('id', input.venue_id)
    .maybeSingle()
  const tvs = ((venue?.tvs ?? []) as { id: string }[]) ?? []
  if (!venue || venue.host_user_id !== profile.id) {
    return { error: 'That screen is not on your account.' }
  }
  if (venue.status !== 'active') {
    return { error: "Your venue is still being reviewed — you can add a promo once it's live." }
  }
  if (!tvs.length) {
    return { error: 'Your screen is still being set up. Try again once it is live.' }
  }

  // One free own-screen promo at a time. The host removes the current one to swap.
  const existing = await getActiveOwnScreenPromos(admin, profile.id, [venue.id])
  if (existing.length) {
    return { error: 'You already have a promo on this screen. Remove it first to add a new one.' }
  }

  // Auto-approved $0 house promo. No category (it's the host's own screen, so
  // there's no line-of-business competition), which keeps placement unrestricted
  // and fills one slot on each of the venue's TVs.
  const { data: ad, error: adErr } = await admin
    .from('ads')
    .insert({
      owner_user_id: profile.id,
      owner_kind: 'host',
      territory_id: venue.territory_id,
      category_id: null,
      host_venue_id: venue.id,
      title: input.title.trim(),
      creative_type: input.creative_type ?? 'image',
      creative_url: input.creative_url,
      status: 'active',
      qr_target_url: input.qr_target_url.trim(),
      qr_x: input.qr_x ?? 0.9,
      qr_y: input.qr_y ?? 0.88,
      qr_size: input.qr_size ?? QR_SIZE_DEFAULT,
    })
    .select('id')
    .single()
  if (adErr || !ad) return { error: adErr?.message ?? 'Could not create your promo.' }

  const { data: campaign, error: cErr } = await admin
    .from('campaigns')
    .insert({
      advertiser_id: profile.id,
      ad_id: ad.id,
      package_id: null,
      territory_id: venue.territory_id,
      monthly_total_cents: 0,
      status: 'active',
    })
    .select('id')
    .single()
  if (cErr || !campaign) return { error: cErr?.message ?? 'Could not create your promo.' }

  await admin.from('campaign_targets').insert({ campaign_id: campaign.id, venue_id: venue.id })

  // Places now: ad is active + campaign is active, so this fills a free slot on
  // each of the venue's own screens.
  await activatePlacementsIfReady(campaign.id, admin)

  revalidatePath('/host')
  revalidatePath('/host/promote')
  return { ok: true }
}

// Remove a host's own-screen promo: free the slot and hide the campaign.
export async function deleteOwnScreenPromo(campaignId: string): Promise<OwnPromoResult> {
  const profile = await requireProfile()
  if (!['host', 'admin'].includes(profile.role)) {
    return { error: 'Only hosts can manage their own-screen promo.' }
  }
  const admin = createAdminClient()

  // Confirm this really is the host's own-screen promo before touching anything.
  const { data: camp } = await admin
    .from('campaigns')
    .select('id, advertiser_id, ad:ads(id, owner_kind)')
    .eq('id', campaignId)
    .maybeSingle()
  type C = {
    id: string
    advertiser_id: string
    ad: { id: string; owner_kind: string } | null
  }
  const c = camp as unknown as C | null
  const ownsIt = c && (c.advertiser_id === profile.id || profile.role === 'admin')
  if (!c || !ownsIt || c.ad?.owner_kind !== 'host') {
    return { error: 'That promo is not on your account.' }
  }

  // End placements (frees the slot + drops it from the TV loop), then cancel and
  // soft-delete the campaign so the nightly placement cron won't re-run it.
  await admin.from('ad_placements').update({ status: 'ended' }).eq('campaign_id', campaignId)
  await admin
    .from('campaigns')
    .update({ status: 'canceled', deleted_at: new Date().toISOString() })
    .eq('id', campaignId)
  if (c.ad?.id) await admin.from('ads').update({ status: 'paused' }).eq('id', c.ad.id)

  revalidatePath('/host')
  revalidatePath('/host/promote')
  return { ok: true }
}
