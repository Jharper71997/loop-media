// Paid, enforced category exclusivity (see migration 0039_exclusivity.sql).
//
// Default is co-run — this module governs the OPT-IN upcharge where an advertiser
// pays to be the only one in their category at a venue. Two rules, from Jacob:
//   • Only SELLABLE where no same-category competitor is already active (we never
//     evict an existing advertiser). If a competitor is on the screen, don't offer it.
//   • Once ACTIVE, it BLOCKS future same-category placements at that venue.
//
// Everything here runs with the service-role admin client (exclusive_slots is
// read-only to owners/admins under RLS; all writes are server-side), so callers
// must already have authorized the action. Server-only.

import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Venues (within `venueIds`) that currently run an ACTIVE same-category ad owned
// by a DIFFERENT advertiser. Exclusivity is NOT sellable at these — buying would
// require evicting a competitor, which we never do.
export async function venuesWithSameCategoryCompetitor(
  admin: Admin,
  categoryId: string,
  buyerId: string,
  venueIds: string[]
): Promise<Set<string>> {
  const scope = new Set(venueIds)
  if (!scope.size) return new Set()
  const { data } = await admin
    .from('ad_placements')
    .select('tv:tvs(venue_id), ad:ads(category_id, owner_user_id)')
    .eq('status', 'active')
  const out = new Set<string>()
  for (const row of (data ?? []) as unknown as {
    tv: { venue_id: string | null } | null
    ad: { category_id: string | null; owner_user_id: string | null } | null
  }[]) {
    const venueId = row.tv?.venue_id
    if (!venueId || !scope.has(venueId)) continue
    if (row.ad?.category_id === categoryId && row.ad?.owner_user_id !== buyerId) out.add(venueId)
  }
  return out
}

// Venues (within `venueIds`) that already have an ACTIVE exclusive for this
// category → venueId → the advertiser who holds it. Used both to gray out "taken"
// venues in the buy UI and to block foreign same-category placements in the engine.
export async function venuesWithActiveExclusive(
  admin: Admin,
  categoryId: string,
  venueIds: string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(venueIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const { data } = await admin
    .from('exclusive_slots')
    .select('venue_id, advertiser_id')
    .eq('category_id', categoryId)
    .eq('status', 'active')
    .in('venue_id', ids)
  const out = new Map<string, string>()
  for (const r of (data ?? []) as { venue_id: string; advertiser_id: string | null }[]) {
    if (r.advertiser_id) out.set(r.venue_id, r.advertiser_id)
  }
  return out
}

// Venues (within `venueIds`) where `buyerId` CAN buy category exclusivity: no
// same-category competitor active AND no active exclusive already held (by anyone).
export async function availableExclusiveVenueIds(
  admin: Admin,
  categoryId: string,
  buyerId: string,
  venueIds: string[]
): Promise<Set<string>> {
  const ids = [...new Set(venueIds.filter(Boolean))]
  if (!ids.length) return new Set()
  const [competitors, taken] = await Promise.all([
    venuesWithSameCategoryCompetitor(admin, categoryId, buyerId, ids),
    venuesWithActiveExclusive(admin, categoryId, ids),
  ])
  return new Set(ids.filter((id) => !competitors.has(id) && !taken.has(id)))
}

// The venue ids a campaign currently holds an exclusive at (pending or active) —
// used to keep the upcharge in the monthly total when screens are added/removed.
export async function campaignExclusiveVenueIds(
  admin: Admin,
  campaignId: string
): Promise<string[]> {
  const { data } = await admin
    .from('exclusive_slots')
    .select('venue_id')
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'active'])
  return (data ?? []).map((r) => r.venue_id as string)
}

// Materialize a campaign's bought exclusivity once payment is confirmed: flip its
// pending (or, on a relaunch, previously-released) slots to active. Guarded so a
// race (two buyers, same venue+category) can't create two active exclusives — the
// partial unique index is the backstop. A slot that can't win the venue+category is
// set BACK to 'released' (not left as a phantom 'pending' that would bill forever
// without holding anything) and logged loudly for manual reconciliation.
export async function activateExclusiveSlots(admin: Admin, campaignId: string): Promise<void> {
  const { data: claimable } = await admin
    .from('exclusive_slots')
    .select('id, venue_id, category_id')
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'released'])
  for (const s of (claimable ?? []) as { id: string; venue_id: string; category_id: string }[]) {
    const { data: taken } = await admin
      .from('exclusive_slots')
      .select('id')
      .eq('venue_id', s.venue_id)
      .eq('category_id', s.category_id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()
    if (taken) {
      // Someone else won this venue+category first. Free the loser's slot so it
      // isn't a phantom, and flag it: the advertiser paid an upcharge for an
      // exclusive they didn't get and needs a manual refund.
      await admin.from('exclusive_slots').update({ status: 'released' }).eq('id', s.id)
      console.error(
        `[exclusivity] campaign ${campaignId} paid for venue ${s.venue_id} / category ${s.category_id} but it was already taken — released the slot; REFUND the upcharge.`
      )
      continue
    }
    const { error } = await admin
      .from('exclusive_slots')
      .update({ status: 'active' })
      .eq('id', s.id)
    if (error) {
      console.error(`[exclusivity] could not activate slot ${s.id}: ${error.message}`)
    }
  }
}

// Free a campaign's exclusives (pause/cancel/remove) so the slot opens for someone
// else. Optionally scope to specific venues (used when only some screens are removed).
export async function releaseExclusiveSlots(
  admin: Admin,
  campaignId: string,
  venueIds?: string[]
): Promise<void> {
  let q = admin
    .from('exclusive_slots')
    .update({ status: 'released' })
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'active'])
  if (venueIds && venueIds.length) q = q.in('venue_id', venueIds)
  await q
}

// Recovery after a paused campaign is paid again: try to re-take its released
// exclusives. Best-effort and guarded — if a competitor grabbed the slot while the
// campaign was paused, that venue simply stays co-run.
export async function reactivateExclusiveSlots(admin: Admin, campaignId: string): Promise<void> {
  const { data: released } = await admin
    .from('exclusive_slots')
    .select('id, venue_id, category_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'released')
  for (const s of (released ?? []) as { id: string; venue_id: string; category_id: string }[]) {
    const { data: taken } = await admin
      .from('exclusive_slots')
      .select('id')
      .eq('venue_id', s.venue_id)
      .eq('category_id', s.category_id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()
    if (taken) continue
    await admin.from('exclusive_slots').update({ status: 'active' }).eq('id', s.id)
  }
}
