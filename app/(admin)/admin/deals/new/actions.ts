'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin, adminCanTerritory } from '@/lib/auth'
import { activatePlacementsIfReady } from '@/lib/placement'
import { QR_SIZE_DEFAULT, clampSpotSeconds, isOwnCreativeUrl } from '@/lib/adCreative'
import { addOneMonth } from '@/lib/billing'

// Server actions for the hand-sold deal.
//
// Everything here exists because the app was built for advertisers who sign
// themselves up and pay through Stripe Checkout — and almost nobody does that.
// Real accounts are sold in person: the creative is built for them, they pay by
// check or on a Stripe account this app doesn't own, and some run comped. Until
// now that meant writing rows by hand in the Supabase dashboard.
//
// The pipeline below is deliberately the SAME one the self-serve flow uses
// (ads → campaigns → campaign_targets → subscriptions → placeCampaign), so a
// hand-sold account is indistinguishable downstream: it reports, it renews, it
// shows up on the advertiser's own dashboard, and the place cron treats it
// normally.

const uuid = () => globalThis.crypto.randomUUID()

// ---------------------------------------------------------------------------
// 1. The advertiser
// ---------------------------------------------------------------------------

export interface NewAdvertiserInput {
  fullName: string
  email: string
  phone?: string | null
  categoryId?: string | null
  territoryId: string
}

// Create a real, loginable advertiser account for someone who was sold offline.
// They get a genuine auth user (so they can later use the advertiser dashboard,
// reports, and the content calendar) with a random password — send them a reset
// link if they ever want in. email_confirm is set because there is nobody to
// click a confirmation link on their behalf.
export async function createAdvertiser(
  input: NewAdvertiserInput
): Promise<{ id?: string; error?: string }> {
  const profile = await requireAdmin()
  const email = input.email.trim().toLowerCase()
  const fullName = input.fullName.trim()
  if (!fullName) return { error: 'Give the business a name.' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'That email address is not valid.' }
  if (!adminCanTerritory(profile, input.territoryId)) {
    return { error: 'That market is outside your territory.' }
  }

  const admin = createAdminClient()

  // Already in the system? Hand back the existing account rather than failing on
  // a duplicate-email error — an operator retyping a customer they already added
  // should land on that customer, not a dead end.
  const { data: existing } = await admin
    .from('profiles')
    .select('id, role')
    .eq('email', email)
    .maybeSingle()
  if (existing) {
    if ((existing as { role: string }).role !== 'advertiser') {
      return { error: 'That email already belongs to a host or admin account.' }
    }
    return { id: (existing as { id: string }).id }
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: `Loop!${uuid()}`,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: 'advertiser' },
  })
  if (error || !data.user) return { error: error?.message ?? 'Could not create the account.' }

  // The on_auth_user_created trigger writes the profile row; upsert to fill in
  // the fields it doesn't know about and to cover the case where the trigger
  // hasn't materialized yet.
  const { error: pErr } = await admin.from('profiles').upsert(
    {
      id: data.user.id,
      email,
      full_name: fullName,
      role: 'advertiser',
      phone: input.phone?.trim() || null,
      territory_id: input.territoryId,
      category_id: input.categoryId || null,
      is_demo: false,
    },
    { onConflict: 'id' }
  )
  if (pErr) return { error: pErr.message }

  revalidatePath('/admin/advertisers')
  return { id: data.user.id }
}

// ---------------------------------------------------------------------------
// 2. The creative
// ---------------------------------------------------------------------------

// Storage RLS pins uploads to `creatives/<auth.uid()>/…` (migration 0022), which
// stops an advertiser from writing into a competitor's folder — and also stops an
// ADMIN from uploading on a customer's behalf. Rather than weaken that policy, we
// mint a short-lived signed upload URL with the service-role key and let the
// browser PUT straight to Supabase. That also keeps a 50 MB video off the Vercel
// function, which caps request bodies far below that.
export async function createCreativeUploadUrl(input: {
  advertiserId: string
  ext: string
}): Promise<{ path?: string; token?: string; publicUrl?: string; error?: string }> {
  await requireAdmin()
  const ext = input.ext.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5) || 'png'
  if (!input.advertiserId) return { error: 'Pick an advertiser first.' }

  const admin = createAdminClient()
  // Path must live in the advertiser's own folder so isOwnCreativeUrl() accepts
  // it — the same guard that stops a post-review bait-and-switch.
  const path = `${input.advertiserId}/${uuid()}.${ext}`
  const { data, error } = await admin.storage.from('creatives').createSignedUploadUrl(path)
  if (error || !data) return { error: error?.message ?? 'Could not start the upload.' }

  const publicUrl = admin.storage.from('creatives').getPublicUrl(path).data.publicUrl
  return { path: data.path, token: data.token, publicUrl }
}

// ---------------------------------------------------------------------------
// 3. The deal
// ---------------------------------------------------------------------------

export type DealBilling =
  | { method: 'stripe'; stripeSubscriptionId: string }
  | { method: 'manual'; amountCents: number; paidAt: string; paidThrough: string | null }
  | { method: 'comp'; compUntil: string }
  | { method: 'later' }

export interface NewDealInput {
  advertiserId: string
  title: string
  categoryId: string | null
  qrTargetUrl: string
  creativeUrl: string | null
  creativeType: 'image' | 'video'
  durationSeconds: number | null
  /** Empty means "we still owe them a creative" — logs a creative request. */
  creativeBrief: string | null
  venueIds: string[]
  monthlyCents: number
  billing: DealBilling
}

export interface DealResult {
  campaignId?: string
  screensPlaced?: number
  /** Venues dropped because the ad is in that venue's own line of business. */
  droppedVenues?: string[]
  needsCreative?: boolean
  error?: string
}

export async function createDeal(input: NewDealInput): Promise<DealResult> {
  const profile = await requireAdmin()
  const supabase = await createClient()
  const admin = createAdminClient()

  const title = input.title.trim()
  if (!title) return { error: 'Give the ad a title.' }
  if (!input.advertiserId) return { error: 'Pick an advertiser.' }
  const qr = input.qrTargetUrl.trim()
  if (!qr) return { error: 'Add a scan link — the QR on the ad has to go somewhere.' }
  let venueIds = [...new Set(input.venueIds.filter(Boolean))]
  if (!venueIds.length) return { error: 'Pick at least one location to run it on.' }
  if (!Number.isFinite(input.monthlyCents) || input.monthlyCents < 0) {
    return { error: 'Enter a monthly price.' }
  }

  // The creative must be a file in this advertiser's own storage folder. An
  // arbitrary URL could be swapped after the fact, which is the exact
  // bait-and-switch ad review exists to prevent — the rule holds even when an
  // admin is the one uploading.
  if (input.creativeUrl && !isOwnCreativeUrl(input.creativeUrl, input.advertiserId)) {
    return { error: 'That creative was not uploaded through this form. Upload it again.' }
  }

  const { data: adv } = await supabase
    .from('profiles')
    .select('id, role, email')
    .eq('id', input.advertiserId)
    .maybeSingle()
  if (!adv || (adv as { role: string }).role !== 'advertiser') {
    return { error: 'That advertiser account no longer exists.' }
  }

  // Host protection, enforced server-side: a venue never runs a competitor's ad
  // in its own line of business. The picker greys these out; this is the backstop.
  const { data: vRows } = await supabase
    .from('venues')
    .select('id, name, territory_id, category_id, status')
    .in('id', venueIds)
  type VRow = { id: string; name: string; territory_id: string; category_id: string | null; status: string }
  const venues = (vRows ?? []) as VRow[]
  const droppedVenues: string[] = []
  if (input.categoryId) {
    for (const v of venues) {
      if (v.category_id === input.categoryId) droppedVenues.push(v.name)
    }
    const blocked = new Set(
      venues.filter((v) => v.category_id === input.categoryId).map((v) => v.id)
    )
    venueIds = venueIds.filter((id) => !blocked.has(id))
  }
  // An inactive venue isn't sellable and the placement engine will skip it anyway.
  const inactive = new Set(venues.filter((v) => v.status !== 'active').map((v) => v.id))
  venueIds = venueIds.filter((id) => !inactive.has(id))
  if (!venueIds.length) {
    return {
      error: droppedVenues.length
        ? `Every location you picked is in this advertiser's own line of business, so their ad can't run there.`
        : 'None of those locations are active.',
    }
  }

  const territoryId = venues.find((v) => venueIds.includes(v.id))?.territory_id
  if (!territoryId) return { error: 'Could not work out the market for those locations.' }
  if (!adminCanTerritory(profile, territoryId)) {
    return { error: 'Those locations are outside your territory.' }
  }

  // ---- The ad ----
  // Approved on the spot: an admin building and placing an ad IS the review, and
  // routing it back through the queue would just make them approve their own
  // work. Without a creative it stays pending — there is nothing to air yet, and
  // the outstanding creative shows up in Content.
  const hasCreative = !!input.creativeUrl
  const now = new Date().toISOString()
  const { data: ad, error: adErr } = await admin
    .from('ads')
    .insert({
      owner_user_id: input.advertiserId,
      owner_kind: 'advertiser',
      territory_id: territoryId,
      category_id: input.categoryId,
      title,
      creative_type: input.creativeType,
      creative_url: input.creativeUrl,
      duration_seconds: clampSpotSeconds(input.durationSeconds ?? 0),
      status: hasCreative ? 'approved' : 'pending',
      reviewed_by: hasCreative ? profile.id : null,
      reviewed_at: hasCreative ? now : null,
      qr_target_url: qr,
      qr_x: 0.9,
      qr_y: 0.88,
      qr_size: QR_SIZE_DEFAULT,
      is_demo: false,
    })
    .select('id')
    .single()
  if (adErr || !ad) return { error: adErr?.message ?? 'Could not create the ad.' }

  // ---- The campaign ----
  const compUntil = input.billing.method === 'comp' ? input.billing.compUntil : null
  const { data: campaign, error: cErr } = await admin
    .from('campaigns')
    .insert({
      advertiser_id: input.advertiserId,
      ad_id: ad.id,
      package_id: null,
      territory_id: territoryId,
      monthly_total_cents: Math.round(input.monthlyCents),
      status: 'active',
      comp_until: compUntil,
      is_demo: false,
    })
    .select('id')
    .single()
  if (cErr || !campaign) return { error: cErr?.message ?? 'Could not create the campaign.' }

  // The picked locations ARE the placement targets.
  await admin
    .from('campaign_targets')
    .insert(venueIds.map((venue_id) => ({ campaign_id: campaign.id, venue_id })))

  // ---- Billing ----
  // Every method gets a subscription row so the account renews, reports, and
  // appears on Money like any other. What differs is the paid-through date and
  // whether a payment lands in the ledger.
  const periodEnd =
    input.billing.method === 'comp'
      ? input.billing.compUntil
      : input.billing.method === 'manual'
        ? (input.billing.paidThrough ?? addOneMonth(input.billing.paidAt))
        : input.billing.method === 'stripe'
          ? addOneMonth(now)
          : null

  await admin.from('subscriptions').insert({
    advertiser_id: input.advertiserId,
    campaign_id: campaign.id,
    package_id: null,
    territory_id: territoryId,
    // 'later' stays incomplete on purpose: it is money we have not collected,
    // and Money surfaces it as "never billed" until somebody does.
    status: input.billing.method === 'later' ? 'incomplete' : 'active',
    stripe_subscription_id:
      input.billing.method === 'stripe' ? input.billing.stripeSubscriptionId.trim() : null,
    current_period_end: periodEnd,
  })

  // A check or cash payment is real money received — it belongs in the same
  // ledger the Stripe webhook writes to, so "collected" means one thing.
  if (input.billing.method === 'manual' && input.billing.amountCents > 0) {
    await admin.from('payments').insert({
      advertiser_id: input.advertiserId,
      campaign_id: campaign.id,
      territory_id: territoryId,
      source: 'check',
      amount_cents: Math.round(input.billing.amountCents),
      paid_at: input.billing.paidAt,
    })
  }

  // Creative we still owe them — lands in Content next to the self-serve ones.
  if (!hasCreative) {
    await admin.from('creative_requests').insert({
      advertiser_id: input.advertiserId,
      brief: input.creativeBrief?.trim() || `Build the spot for ${title}.`,
    })
  }

  // ---- On air ----
  const outcome = await activatePlacementsIfReady(campaign.id, admin)

  revalidatePath('/admin')
  revalidatePath('/admin/sell')
  revalidatePath('/admin/money')
  revalidatePath('/admin/advertisers')
  revalidatePath(`/admin/advertisers/${input.advertiserId}`)

  return {
    campaignId: campaign.id,
    screensPlaced: outcome?.created ?? 0,
    droppedVenues,
    needsCreative: !hasCreative,
  }
}
