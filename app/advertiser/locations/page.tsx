import Link from 'next/link'
import { Plus, MapPin } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { formatNumber, isTvLive } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PERF_WINDOW_DAYS } from '@/lib/analytics'
import type { QrPosition } from '@/lib/db.types'
import { AdScreenPreview } from '@/components/app/AdScreenPreview'
import AdsMap, { type AdsMapVenue } from '../AdsMap'

// Every real place the advertiser's ad runs — named, with city, live status, and
// measured scans per location — plus a true-to-the-TV preview of their ad.
export default async function LocationsPage() {
  const profile = await requireProfile()
  const supabase = await createClient()

  const { data: campsData } = await supabase
    .from('campaigns')
    .select(
      'id, created_at, ad:ads(id, title, creative_url, creative_type, qr_target_url, qr_position)'
    )
    .eq('advertiser_id', profile.id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  type Ad = {
    id: string
    title: string
    creative_url: string | null
    creative_type: 'video' | 'image'
    qr_target_url: string | null
    qr_position: QrPosition
  }
  type CampRow = { id: string; created_at: string; ad: Ad | null }
  const camps = (campsData ?? []) as unknown as CampRow[]
  const campaignIds = camps.map((c) => c.id)
  const adIds = [...new Set(camps.map((c) => c.ad?.id).filter(Boolean) as string[])]
  const previewAd = camps.map((c) => c.ad).find((a): a is Ad => !!a?.creative_url) ?? null

  // eslint-disable-next-line react-hooks/purity -- server component; per-request timestamp is correct here
  const cutoff = new Date(Date.now() - PERF_WINDOW_DAYS * 86_400_000).toISOString()
  const [placementsRes, scansRes] = await Promise.all([
    campaignIds.length
      ? supabase
          .from('ad_placements')
          .select(
            'tv:tvs(id, last_heartbeat_at, venue:venues(id, name, city, state, lat, lng))'
          )
          .in('campaign_id', campaignIds)
          .eq('status', 'active')
      : Promise.resolve({ data: [] as unknown[] }),
    adIds.length
      ? supabase.from('qr_scans').select('tv_id').in('ad_id', adIds).gte('scanned_at', cutoff)
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  type PRow = {
    tv: {
      id: string
      last_heartbeat_at: string | null
      venue: {
        id: string
        name: string
        city: string | null
        state: string | null
        lat: number | null
        lng: number | null
      } | null
    } | null
  }
  type VenueRow = {
    id: string
    name: string
    city: string | null
    state: string | null
    lat: number | null
    lng: number | null
    live: boolean
    scans: number
  }
  const byVenue = new Map<string, VenueRow>()
  const tvToVenue = new Map<string, string>()
  for (const p of (((placementsRes as { data: unknown[] }).data ?? []) as PRow[])) {
    const v = p.tv?.venue
    if (!v) continue
    if (p.tv?.id) tvToVenue.set(p.tv.id, v.id)
    const e: VenueRow =
      byVenue.get(v.id) ?? {
        id: v.id,
        name: v.name,
        city: v.city,
        state: v.state,
        lat: v.lat,
        lng: v.lng,
        live: false,
        scans: 0,
      }
    if (isTvLive(p.tv?.last_heartbeat_at ?? null)) e.live = true
    byVenue.set(v.id, e)
  }
  for (const s of (((scansRes as { data: unknown[] }).data ?? []) as { tv_id: string | null }[])) {
    const vid = s.tv_id ? tvToVenue.get(s.tv_id) : null
    if (!vid) continue
    const e = byVenue.get(vid)
    if (e) e.scans += 1
  }
  const venues = [...byVenue.values()].sort(
    (a, b) => Number(b.live) - Number(a.live) || b.scans - a.scans
  )
  const mapVenues: AdsMapVenue[] = venues.map((v) => ({
    id: v.id,
    name: v.name,
    lat: v.lat,
    lng: v.lng,
    ads: [{ title: previewAd?.title ?? 'Your ad', live: v.live }],
  }))
  const geoVenues = mapVenues.filter((v) => v.lat != null && v.lng != null)
  const center: [number, number] = geoVenues.length
    ? [
        geoVenues.reduce((s, v) => s + (v.lat as number), 0) / geoVenues.length,
        geoVenues.reduce((s, v) => s + (v.lng as number), 0) / geoVenues.length,
      ]
    : [34.7541, -77.4302]
  const liveCount = venues.filter((v) => v.live).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Locations</h1>
        <p className="text-sm text-muted-foreground">The real places your ad is running.</p>
      </div>

      {venues.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-primary/10">
              <MapPin className="size-6 text-primary" />
            </span>
            <p className="max-w-xs text-sm text-muted-foreground">
              Once a campaign is live, every venue your ad plays at shows up here — by name, with its
              live status.
            </p>
            <Link href="/advertiser/browse" className={cn(buttonVariants(), 'h-11')}>
              <Plus className="size-4" /> Pick screens
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {previewAd && (
            <section className="space-y-2">
              <h2 className="font-heading text-lg font-semibold">On screen now</h2>
              <AdScreenPreview
                creativeUrl={previewAd.creative_url}
                creativeType={previewAd.creative_type}
                qrUrl={previewAd.qr_target_url}
                qrPosition={previewAd.qr_position}
              />
              <p className="text-xs text-muted-foreground">
                This is exactly how your ad shows on the TVs, with your scan code in the corner.
              </p>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-lg font-semibold">
                {venues.length} location{venues.length === 1 ? '' : 's'}
              </h2>
              <span className="text-xs text-muted-foreground">{liveCount} live now</span>
            </div>
            <Card className="py-0">
              <CardContent className="divide-y divide-border p-0">
                {venues.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{v.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[v.city, v.state].filter(Boolean).join(', ') || 'Local venue'}
                        {v.scans > 0 && (
                          <>
                            {' · '}
                            {formatNumber(v.scans)} scan{v.scans === 1 ? '' : 's'}
                          </>
                        )}
                      </p>
                    </div>
                    {v.live ? (
                      <Badge className="shrink-0 gap-1.5 bg-emerald-600">
                        <span className="size-1.5 rounded-full bg-white" /> Live now
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0">
                        Coming online
                      </Badge>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
            {geoVenues.length > 0 && <AdsMap venues={mapVenues} center={center} />}
          </section>

          <Link
            href="/advertiser/browse"
            className={cn(buttonVariants({ variant: 'outline' }), 'h-11 w-full')}
          >
            <Plus className="size-4" /> Add more screens
          </Link>
        </>
      )}
    </div>
  )
}
