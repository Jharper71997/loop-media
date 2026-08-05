import { createAdminClient } from '@/lib/supabase/admin'

// The real ads currently running on the network, for the PUBLIC marketing pages.
//
// Read with the service-role client (ads/placements aren't readable under anon
// RLS) but deliberately narrowed to fields that are already public by nature:
// the creative itself, its title, its category, and how many venues it plays at.
// No advertiser identity, spend, contract, or scan data ever crosses this line.
//
// "Running" means the ad has at least one ACTIVE placement — i.e. it is on a
// screen right now. Ad status may be 'active' or 'approved'; both are live, the
// distinction is internal, so both qualify and neither is surfaced.

export type LiveAd = {
  id: string
  title: string
  creativeUrl: string
  creativeType: 'video' | 'image'
  qrUrl: string | null
  category: string | null
  /** Distinct venues this ad is currently placed at. */
  venues: number
}

type PlacementRow = {
  ad: {
    id: string
    title: string
    status: string
    creative_url: string | null
    creative_type: 'video' | 'image'
    qr_target_url: string | null
    category: { name: string } | null
  } | null
  tv: { venue: { id: string } | null } | null
}

const LIVE_AD_STATUSES = ['active', 'approved']

export async function getLiveAds(limit?: number): Promise<LiveAd[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('ad_placements')
    .select(
      'ad:ads(id, title, status, creative_url, creative_type, qr_target_url, category:categories(name)), tv:tvs(venue:venues(id))'
    )
    .eq('status', 'active')
  const rows = (data ?? []) as unknown as PlacementRow[]

  // Fold placements up to one row per ad, counting DISTINCT venues (an ad on two
  // TVs in one bar is one location, not two).
  const byAd = new Map<string, { ad: NonNullable<PlacementRow['ad']>; venues: Set<string> }>()
  for (const r of rows) {
    const ad = r.ad
    if (!ad?.creative_url || !LIVE_AD_STATUSES.includes(ad.status)) continue
    const entry = byAd.get(ad.id) ?? { ad, venues: new Set<string>() }
    if (r.tv?.venue?.id) entry.venues.add(r.tv.venue.id)
    byAd.set(ad.id, entry)
  }

  const ads: LiveAd[] = [...byAd.values()]
    .map(({ ad, venues }) => ({
      id: ad.id,
      title: ad.title,
      creativeUrl: ad.creative_url as string,
      creativeType: ad.creative_type,
      // A QR only renders when the advertiser gave a real destination. Some rows
      // hold an email or a truncated URL, which would make a QR that scans to
      // nothing — require an http(s) URL before drawing one.
      qrUrl: isWebUrl(ad.qr_target_url) ? ad.qr_target_url : null,
      category: ad.category?.name ?? null,
      venues: venues.size,
    }))
    // Widest reach first — the most convincing examples lead.
    .sort((a, b) => b.venues - a.venues || a.title.localeCompare(b.title))

  return limit ? ads.slice(0, limit) : ads
}

function isWebUrl(value: string | null): value is string {
  if (!value) return false
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
