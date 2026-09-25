// What each host is owed, and what they actually have.
//
// The deal is two free advertising screens for every screen a host puts in their
// establishment. It was implemented as a flat "2 free TVs" Stripe code, minted
// when a venue goes live, and then nothing ever checked whether the host used it
// — so the perk existed in code, was printed on their dashboard, and six of the
// eight hosts running live venues had never received a single free screen.
//
// A host's free advertising is therefore NOT a comp to be converted. It is the
// consideration in the hosting agreement, and the admin has to tell the two
// apart: a comped advertiser is revenue we chose to forgo, a comped host is
// revenue we never had. Anything above the allowance is the discretionary part.
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { FREE_SCREENS_PER_HOSTED_TV } from '@/lib/hostComp'
import { loadBillingRows } from '@/lib/adminInbox'

export interface HostBenefit {
  hostId: string
  name: string
  email: string | null
  phone: string | null
  venueNames: string[]
  venueIds: string[]
  /** Screens they host for us at live venues. */
  hostedTvs: number
  /** What that earns them: two per hosted screen. */
  owed: number
  /** Free advertising screens they are actually running today. */
  using: number
  /** Positive = we owe them. Negative = they run more free than the deal covers. */
  gap: number
  compCode: string | null
}

type VenueRow = {
  id: string
  name: string
  status: string
  host_user_id: string | null
  comp_promo_code: string | null
  is_demo: boolean
  territory_id: string
  tvs: { id: string }[] | null
}

export const loadHostBenefits = cache(
  async (territoryId: string | null): Promise<HostBenefit[]> => {
    const supabase = await createClient()

    let vq = supabase
      .from('venues')
      .select('id, name, status, host_user_id, comp_promo_code, is_demo, territory_id, tvs(id)')
      .eq('status', 'active')
      .not('host_user_id', 'is', null)
    if (territoryId) vq = vq.eq('territory_id', territoryId)
    const { data: vData } = await vq
    const venues = ((vData ?? []) as unknown as VenueRow[]).filter((v) => !v.is_demo)
    if (!venues.length) return []

    const hostIds = [...new Set(venues.map((v) => v.host_user_id!))]

    // What free advertising each host is actually running right now, in SCREENS
    // (the unit the deal is written in). This reads the billing rollup rather
    // than looking for comped or $0 campaigns: a host who took the deal went
    // through checkout with their 100%-off code, so the campaign carries a list
    // price and a Stripe subscription that charges nothing. Counting only comps
    // reported every one of those hosts as owed screens they already had.
    // Free = the screens their perk covers, plus every screen on a campaign that
    // is free anyway (comped or priced at nothing).
    const [{ data: profiles }, billing, { data: hostAdPlaces }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, phone').in('id', hostIds),
      loadBillingRows(territoryId),
      // Ads marked as a host's own (ads.host_venue_id) that are on screens.
      supabase
        .from('ad_placements')
        .select('campaign_id, ad:ads!inner(host_venue_id)')
        .eq('status', 'active')
        .in(
          'ad.host_venue_id',
          venues.map((v) => v.id)
        ),
    ])
    const profileById = new Map(
      ((profiles ?? []) as { id: string; full_name: string | null; email: string; phone: string | null }[]).map(
        (p) => [p.id, p]
      )
    )

    const hostSet = new Set(hostIds)
    const usingByHost = new Map<string, number>()
    for (const r of billing) {
      if (!hostSet.has(r.advertiserId)) continue
      const free = r.billing.method === 'comp' || r.listCents === 0 ? r.screens : r.hostFreeScreens
      usingByHost.set(r.advertiserId, (usingByHost.get(r.advertiserId) ?? 0) + free)
    }
    // Host ads outside a live campaign (none, or canceled) are free screens the
    // host is using too. Ones on a live campaign were counted above.
    const liveCampaigns = new Set(billing.map((b) => b.campaignId))
    const hostByVenue = new Map(venues.map((v) => [v.id, v.host_user_id!]))
    for (const p of (hostAdPlaces ?? []) as unknown as {
      campaign_id: string | null
      ad: { host_venue_id: string | null } | { host_venue_id: string | null }[] | null
    }[]) {
      if (p.campaign_id && liveCampaigns.has(p.campaign_id)) continue
      const ad = Array.isArray(p.ad) ? p.ad[0] : p.ad
      const host = ad?.host_venue_id ? hostByVenue.get(ad.host_venue_id) : undefined
      if (host) usingByHost.set(host, (usingByHost.get(host) ?? 0) + 1)
    }

    return hostIds
      .map((hostId) => {
        const theirs = venues.filter((v) => v.host_user_id === hostId)
        const hostedTvs = theirs.reduce((n, v) => n + (v.tvs?.length ?? 0), 0)
        const owed = hostedTvs * FREE_SCREENS_PER_HOSTED_TV
        const using = usingByHost.get(hostId) ?? 0
        const p = profileById.get(hostId)
        return {
          hostId,
          name: p?.full_name ?? p?.email ?? 'Unknown host',
          email: p?.email ?? null,
          phone: p?.phone ?? null,
          venueNames: theirs.map((v) => v.name).sort(),
          venueIds: theirs.map((v) => v.id),
          hostedTvs,
          owed,
          using,
          gap: owed - using,
          compCode: theirs.find((v) => v.comp_promo_code)?.comp_promo_code ?? null,
        }
      })
      .sort((a, b) => b.gap - a.gap || b.owed - a.owed)
  }
)

/** Screens this host runs free that the hosting deal does NOT cover. */
export function discretionaryFreeScreens(b: HostBenefit | undefined): number {
  if (!b) return 0
  return Math.max(0, b.using - b.owed)
}
