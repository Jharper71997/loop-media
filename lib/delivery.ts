// Where every ad is running, on one page.
//
// Before this, "which screens is Cristina on and how often did she air there"
// meant opening each screen's page and reading its loop, and "who is on
// Brassa" meant the same trip in the other direction. The data was all there,
// just keyed by screen. This folds every live placement in the network into one
// grid, readable from either side: by advertiser (where does their money go) and
// by location (what is each screen carrying).
//
// Numbers keep the provenance rules of lib/cases.ts: plays and scans are
// MEASURED over the same 30-day window as the Advertisers roster, counted per
// (ad, screen) and never fetched, because ad_plays is far too big to pull back.
// These are ALL plays, including any a screen ran after closing, so they match
// the roster rather than the advertiser's own open-hours report.
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { screenDownState } from '@/lib/uptime'
import { loadBillingRows } from '@/lib/adminInbox'
import type { BillingMethod } from '@/lib/billing'
import type { VenueHours } from '@/lib/openHours'

export const DELIVERY_WINDOW_DAYS = 30

// Ad statuses the TV loop actually plays. A placement on a pending or paused ad
// is a booking, not delivery.
const AIRING = ['active', 'approved']

/** One ad on one screen. The atom both views are built from. */
export interface Spot {
  placementId: string
  adId: string
  campaignId: string | null
  adTitle: string
  /** The account the money belongs to, or a `house:` key when you built it on your own login. */
  advertiserId: string
  advertiserName: string
  /** True when the ad sits on an admin login with no campaign, so billing cannot see it. */
  noAccount: boolean
  /** Campaign ended but the ad is still on the screen. */
  canceled: boolean
  /** Set when the ad is marked as a venue host's own ad (ads.host_venue_id). */
  hostVenueId: string | null
  hostVenueName: string | null
  tvId: string
  venueId: string
  venueName: string
  /** "Brassa" or "Brassa · screen 2" when the venue has more than one. */
  screenLabel: string
  dark: boolean
  /** Null when the count could not be read this time; never shown as 0. */
  plays: number | null
  scans: number
}

export interface AdvertiserDelivery {
  advertiserId: string
  name: string
  /** Null for ads with no account behind them (nothing to link to). */
  href: string | null
  noAccount: boolean
  canceled: boolean
  /** The venue whose host this is, when their ad is marked as a host ad. */
  hostVenueName: string | null
  /** Best guess at the venue to offer when marking them as a host. */
  suggestedVenueId: string | null
  monthlyCents: number
  /** Comped or never billed: running, but not revenue. */
  free: boolean
  method: BillingMethod | null
  ads: number
  locations: number
  darkScreens: number
  /** Null while any of their screens' counts is unavailable. */
  plays: number | null
  scans: number
  spots: Spot[]
}

export interface LocationDelivery {
  venueId: string
  name: string
  screens: number
  darkScreens: number
  advertisers: number
  /** Ad slots in use across the venue's screens, and how many there are. */
  slotsUsed: number
  slotsTotal: number
  plays: number | null
  scans: number
  spots: Spot[]
  /** First screen, for the row link. */
  tvId: string
}

/** A screen an ad could be put on, for the "Add to screen" picker. */
export interface ScreenOption {
  tvId: string
  label: string
  /** Empty ad slots left in its loop. 0 = full, can't take another ad. */
  free: number
  dark: boolean
}

export interface VenueOption {
  id: string
  name: string
}

export interface Delivery {
  byAdvertiser: AdvertiserDelivery[]
  byLocation: LocationDelivery[]
  screens: ScreenOption[]
  venues: VenueOption[]
  totals: {
    advertisers: number
    ads: number
    locations: number
    screens: number
    darkScreens: number
    plays: number
    scans: number
  }
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

// An exact count per (ad, screen), cached across requests. The window start is
// computed INSIDE the cached function rather than passed in: a key that carries
// the timestamp changes every hour and turns every spot cold at once, and a cold
// count on this table takes seconds (the first load measured 40s for ~85 spots).
// Keyed on the pair alone, a stale value is served instantly while a fresh one is
// computed in the background, so the window just trails by up to 15 minutes.
const cachedSpotPlays = unstable_cache(
  async (adId: string, tvId: string): Promise<number> => {
    const sinceISO = new Date(Date.now() - DELIVERY_WINDOW_DAYS * 86_400_000).toISOString()
    const { count, error } = await createAdminClient()
      .from('ad_plays')
      .select('*', { count: 'exact', head: true })
      .eq('ad_id', adId)
      .eq('tv_id', tvId)
      .gte('played_at', sinceISO)
    // Throw, never return 0: a returned value is cached for 15 minutes, and a
    // failed count cached as a measured zero is how whole rows read "0 shown".
    // A throw is not cached, and during a background refresh the last good value
    // is kept.
    if (error || count == null) throw new Error(`ad_plays count failed for ${adId}/${tvId}: ${error?.message ?? 'no count'}`)
    return count
  },
  ['ad-plays-spot-30d-v2'],
  { revalidate: 900 }
)

/** Run `fn` over `items` with at most `limit` in flight, so ~100 counts don't hit PostgREST at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Total plays, or null if any count in the set is missing — a partial sum would undercount. */
function sumPlays(list: Spot[]): number | null {
  let total = 0
  for (const s of list) {
    if (s.plays == null) return null
    total += s.plays
  }
  return total
}

type PlacementRow = {
  id: string
  ad_id: string
  tv_id: string
  campaign_id: string | null
  campaign: { status: string } | null
  ad: {
    title: string
    status: string
    owner_kind: string
    owner_user_id: string | null
    host_venue_id: string | null
    host_venue: { name: string } | { name: string }[] | null
    owner: { full_name: string | null; email: string; is_demo: boolean; role: string } | null
  } | null
  tv: {
    id: string
    venue_id: string
    last_heartbeat_at: string | null
    loop_length_seconds: number
    slot_seconds: number
    venue: ({ id: string; name: string; territory_id: string } & VenueHours) | null
  } | null
}

export const loadDelivery = cache(async (territoryId: string | null): Promise<Delivery> => {
  const admin = createAdminClient()
  const since = new Date(Date.now() - DELIVERY_WINDOW_DAYS * 86_400_000)
  since.setUTCMinutes(0, 0, 0)
  const sinceISO = since.toISOString()

  const [{ data: placeData }, billing, { data: venueData }, { data: tvData }] = await Promise.all([
    admin
      .from('ad_placements')
      .select(
        `id, ad_id, tv_id, campaign_id, campaign:campaigns(status),
         ad:ads(title, status, owner_kind, owner_user_id, host_venue_id, host_venue:venues!host_venue_id(name), owner:profiles!owner_user_id(full_name, email, is_demo, role)),
         tv:tvs(id, venue_id, last_heartbeat_at, loop_length_seconds, slot_seconds,
           venue:venues(id, name, territory_id, business_open, business_close, business_days, business_hours))`
      )
      .eq('status', 'active'),
    loadBillingRows(territoryId),
    admin.from('venues').select('id, name, host_user_id, territory_id, is_demo').order('name'),
    // Every screen, placed or not, for the picker.
    admin
      .from('tvs')
      .select(
        `id, venue_id, last_heartbeat_at, loop_length_seconds, slot_seconds,
         venue:venues(id, name, territory_id, is_demo, business_open, business_close, business_days, business_hours)`
      ),
  ])

  const placements = ((placeData ?? []) as unknown as PlacementRow[])
    .map((p) => {
      const tv = one(p.tv)
      return {
        ...p,
        campaign: one(p.campaign),
        ad: one(p.ad),
        tv: tv ? { ...tv, venue: one(tv.venue) } : null,
      }
    })
    .filter(
      (p) =>
        p.ad &&
        p.tv?.venue &&
        // Advertiser ads and host promos both take real slots on real screens.
        (p.ad.owner_kind === 'advertiser' || p.ad.owner_kind === 'host') &&
        p.ad.owner_user_id &&
        AIRING.includes(p.ad.status) &&
        !one(p.ad.owner)?.is_demo &&
        (!territoryId || p.tv.venue.territory_id === territoryId)
    )

  // Label screens by venue, numbered when a venue has more than one.
  const tvsByVenue = new Map<string, string[]>()
  for (const p of placements) {
    const list = tvsByVenue.get(p.tv!.venue_id) ?? []
    if (!list.includes(p.tv!.id)) list.push(p.tv!.id)
    tvsByVenue.set(p.tv!.venue_id, list)
  }
  for (const list of tvsByVenue.values()) list.sort()

  const adIds = [...new Set(placements.map((p) => p.ad_id))]
  const [playCounts, { data: scanData }] = await Promise.all([
    mapLimit(placements, 6, async (p) => {
      // One retry: most failures are the database shedding a burst of counts.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await cachedSpotPlays(p.ad_id, p.tv_id)
        } catch (e) {
          if (attempt) console.error((e as Error).message)
        }
      }
      return null
    }),
    adIds.length
      ? admin
          .from('qr_scans')
          .select('ad_id, tv_id')
          .in('ad_id', adIds)
          .eq('is_bot', false)
          .gte('scanned_at', sinceISO)
      : Promise.resolve({ data: [] as { ad_id: string; tv_id: string | null }[] }),
  ])
  const scansBySpot = new Map<string, number>()
  for (const s of (scanData ?? []) as { ad_id: string; tv_id: string | null }[]) {
    if (!s.tv_id) continue
    const k = `${s.ad_id}:${s.tv_id}`
    scansBySpot.set(k, (scansBySpot.get(k) ?? 0) + 1)
  }

  const spots: Spot[] = placements.map((p, i) => {
    const tv = p.tv!
    const venue = tv.venue!
    const owner = one(p.ad!.owner)
    const siblings = tvsByVenue.get(venue.id) ?? []
    // Ads you built and placed from your own admin login have no campaign and no
    // customer account behind them, so the owner is you for every one of them.
    // The ad title is the only thing that names the business, so group on that.
    const noAccount = owner?.role === 'admin' && !p.campaign_id
    return {
      placementId: p.id,
      adId: p.ad_id,
      campaignId: p.campaign_id,
      adTitle: p.ad!.title,
      advertiserId: noAccount ? `house:${p.ad!.title.trim().toLowerCase()}` : p.ad!.owner_user_id!,
      advertiserName: noAccount
        ? p.ad!.title
        : owner?.full_name || owner?.email || 'Unknown advertiser',
      noAccount,
      canceled: p.campaign?.status === 'canceled',
      hostVenueId: p.ad!.host_venue_id,
      hostVenueName: one(p.ad!.host_venue)?.name ?? null,
      tvId: tv.id,
      venueId: venue.id,
      venueName: venue.name,
      screenLabel:
        siblings.length > 1 ? `${venue.name} · screen ${siblings.indexOf(tv.id) + 1}` : venue.name,
      dark: screenDownState(tv.last_heartbeat_at, venue).down,
      plays: playCounts[i],
      scans: scansBySpot.get(`${p.ad_id}:${p.tv_id}`) ?? 0,
    }
  })

  // ---- venues, for "Mark as host ad" ----
  const allVenues = ((venueData ?? []) as {
    id: string
    name: string
    host_user_id: string | null
    territory_id: string
    is_demo: boolean
  }[]).filter((v) => !v.is_demo && (!territoryId || v.territory_id === territoryId))
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
  // The venue they host, if they are a host; else a venue whose name matches the
  // business ("El Cerro Tacos" the ad → El Cerro Tacos the venue).
  const suggestVenue = (advertiserId: string, list: Spot[]): string | null => {
    const hosted = allVenues.find((v) => v.host_user_id === advertiserId)
    if (hosted) return hosted.id
    const n = norm(list[0].advertiserName)
    const byName = allVenues.find((v) => {
      const vn = norm(v.name)
      return n.length >= 4 && vn.length >= 4 && (vn.startsWith(n) || n.startsWith(vn))
    })
    return byName?.id ?? null
  }

  // ---- by advertiser ----
  const billingByAdvertiser = new Map<string, typeof billing>()
  for (const b of billing) {
    billingByAdvertiser.set(b.advertiserId, [...(billingByAdvertiser.get(b.advertiserId) ?? []), b])
  }
  const spotsByAdvertiser = new Map<string, Spot[]>()
  for (const s of spots) {
    spotsByAdvertiser.set(s.advertiserId, [...(spotsByAdvertiser.get(s.advertiserId) ?? []), s])
  }
  const byAdvertiser: AdvertiserDelivery[] = [...spotsByAdvertiser.entries()].map(([id, list]) => {
    const bills = list[0].noAccount ? [] : (billingByAdvertiser.get(id) ?? [])
    const methods = bills.map((b) => b.billing.method)
    const free = !methods.length || methods.every((m) => m === 'comp' || m === 'unbilled' || m === 'host')
    return {
      advertiserId: id,
      name: list[0].advertiserName,
      href: list[0].noAccount ? null : `/admin/advertisers/${id}`,
      noAccount: list[0].noAccount,
      canceled: list.some((s) => s.canceled),
      hostVenueName: list.find((s) => s.hostVenueName)?.hostVenueName ?? null,
      suggestedVenueId: suggestVenue(id, list),
      monthlyCents: bills.reduce((s, b) => s + b.monthlyCents, 0),
      free,
      method: methods[0] ?? null,
      ads: new Set(list.map((s) => s.adId)).size,
      locations: new Set(list.map((s) => s.venueId)).size,
      darkScreens: new Set(list.filter((s) => s.dark).map((s) => s.tvId)).size,
      plays: sumPlays(list),
      scans: list.reduce((s, x) => s + x.scans, 0),
      spots: [...list].sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0)),
    }
  })

  // ---- by location ----
  const tvMeta = new Map(placements.map((p) => [p.tv!.id, p.tv!]))
  const spotsByVenue = new Map<string, Spot[]>()
  for (const s of spots) spotsByVenue.set(s.venueId, [...(spotsByVenue.get(s.venueId) ?? []), s])
  const byLocation: LocationDelivery[] = [...spotsByVenue.entries()].map(([venueId, list]) => {
    const tvIds = tvsByVenue.get(venueId) ?? []
    return {
      venueId,
      name: list[0].venueName,
      screens: tvIds.length,
      darkScreens: new Set(list.filter((s) => s.dark).map((s) => s.tvId)).size,
      advertisers: new Set(list.map((s) => s.advertiserId)).size,
      slotsUsed: list.length,
      slotsTotal: tvIds.reduce((sum, id) => {
        const tv = tvMeta.get(id)
        return sum + (tv && tv.slot_seconds > 0 ? Math.floor(tv.loop_length_seconds / tv.slot_seconds) : 0)
      }, 0),
      plays: sumPlays(list),
      scans: list.reduce((s, x) => s + x.scans, 0),
      spots: [...list].sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0)),
      tvId: tvIds[0],
    }
  })

  // ---- screens for the picker ----
  // Slot use counts EVERY active placement on the screen (any owner), the same
  // number addPlacement checks before it will drop an ad in.
  type TvRow = {
    id: string
    venue_id: string
    last_heartbeat_at: string | null
    loop_length_seconds: number
    slot_seconds: number
    venue: ({ id: string; name: string; territory_id: string; is_demo: boolean } & VenueHours) | null
  }
  const tvRows = ((tvData ?? []) as unknown as (Omit<TvRow, 'venue'> & { venue: TvRow['venue'] | TvRow['venue'][] })[])
    .map((t) => ({ ...t, venue: one(t.venue) }))
    .filter((t) => t.venue && !t.venue.is_demo && (!territoryId || t.venue.territory_id === territoryId))
  const usedByTv = new Map<string, number>()
  for (const p of (placeData ?? []) as unknown as { tv_id: string }[]) {
    usedByTv.set(p.tv_id, (usedByTv.get(p.tv_id) ?? 0) + 1)
  }
  const siblingsByVenue = new Map<string, string[]>()
  for (const t of tvRows) siblingsByVenue.set(t.venue_id, [...(siblingsByVenue.get(t.venue_id) ?? []), t.id].sort())
  const screens: ScreenOption[] = tvRows
    .map((t) => {
      const sib = siblingsByVenue.get(t.venue_id) ?? []
      const cap = Math.max(1, Math.floor((t.loop_length_seconds || 360) / (t.slot_seconds || 15)))
      return {
        tvId: t.id,
        label: sib.length > 1 ? `${t.venue!.name} · screen ${sib.indexOf(t.id) + 1}` : t.venue!.name,
        free: Math.max(0, cap - (usedByTv.get(t.id) ?? 0)),
        dark: screenDownState(t.last_heartbeat_at, t.venue!).down,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))

  const allTvs = new Set(spots.map((s) => s.tvId))
  return {
    byAdvertiser,
    byLocation,
    screens,
    venues: allVenues.map((v) => ({ id: v.id, name: v.name })),
    totals: {
      advertisers: byAdvertiser.length,
      ads: adIds.length,
      locations: byLocation.length,
      screens: allTvs.size,
      darkScreens: new Set(spots.filter((s) => s.dark).map((s) => s.tvId)).size,
      plays: sumPlays(spots) ?? 0,
      scans: spots.reduce((s, x) => s + x.scans, 0),
    },
  }
})
