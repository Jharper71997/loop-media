import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ImageOff, ArrowLeft, MapPin } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatNumber, formatCents } from '@/lib/format'
import type { Ad, Campaign } from '@/lib/db.types'
import {
  dailySeries,
  locationRows,
  estImpressionsPerMonth,
  venuesCenter,
  PERF_WINDOW_DAYS,
  type RunningVenue,
  type ScanRow,
} from '@/lib/analytics'
import { CampaignControls } from './CampaignControls'
import CampaignMap from './CampaignMap'
import type { CampaignMapVenue } from './CampaignMapView'

type CampaignFull = Campaign & {
  ad: Ad | null
  package: { name: string; base_price_cents: number } | null
}

export default async function CampaignDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ checkout?: string }>
}) {
  await requireProfile()
  const { id } = await params
  const { checkout } = await searchParams
  const supabase = await createClient()

  const { data } = await supabase
    .from('campaigns')
    .select('*, ad:ads(*), package:packages(name, base_price_cents)')
    .eq('id', id)
    .maybeSingle()
  if (!data) notFound()
  const c = data as unknown as CampaignFull

  const { data: placementsData } = await supabase
    .from('ad_placements')
    .select('id, tv:tvs(id, venue:venues(id, name, lat, lng, foot_traffic_estimate))')
    .eq('campaign_id', id)
    .neq('status', 'ended')
  type PRow = {
    id: string
    tv: {
      id: string
      venue: {
        id: string
        name: string
        lat: number | null
        lng: number | null
        foot_traffic_estimate: number
      } | null
    } | null
  }
  const placements = (placementsData ?? []) as unknown as PRow[]

  // Distinct running venues + the screens at each (one venue can host several TVs).
  const venueMap = new Map<string, RunningVenue>()
  for (const p of placements) {
    const v = p.tv?.venue
    const tvId = p.tv?.id
    if (!v || !tvId) continue
    const existing = venueMap.get(v.id)
    if (existing) existing.tvIds.push(tvId)
    else
      venueMap.set(v.id, {
        venueId: v.id,
        name: v.name,
        lat: v.lat,
        lng: v.lng,
        footTraffic: v.foot_traffic_estimate ?? 0,
        tvIds: [tvId],
      })
  }
  const venues = [...venueMap.values()]

  // Measured QR scans over the reporting window (attributed to a screen + day).
  let scans: ScanRow[] = []
  if (c.ad_id) {
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - PERF_WINDOW_DAYS)
    const { data: scanData } = await supabase
      .from('qr_scans')
      .select('tv_id, scanned_at')
      .eq('ad_id', c.ad_id)
      .gte('scanned_at', since.toISOString())
    scans = (scanData ?? []) as ScanRow[]
  }

  const estImpressions = estImpressionsPerMonth(venues)
  const locations = venues.length
  const totalScans = scans.length

  const series = dailySeries(venues, scans)
  const rows = locationRows(venues, scans)
  const maxScans = Math.max(1, ...series.map((d) => d.scans))
  const estPerDayTotal = series[0]?.estImpressions ?? 0
  const mapVenues: CampaignMapVenue[] = rows.map((r) => {
    const v = venueMap.get(r.venueId)!
    return { id: r.venueId, name: r.name, lat: v.lat, lng: v.lng, footTraffic: r.estPerMonth, scans: r.scans }
  })
  const hasGeo = mapVenues.some((v) => v.lat != null && v.lng != null)

  const adStatus = c.ad?.status
  const statusBadge =
    adStatus === 'rejected'
      ? { label: 'Rejected', cls: 'bg-destructive' }
      : adStatus === 'pending'
        ? { label: 'Pending review', cls: 'bg-amber-600' }
        : c.status === 'active'
          ? { label: 'Active', cls: 'bg-emerald-600' }
          : c.status === 'paused'
            ? { label: 'Paused', cls: 'bg-zinc-600' }
            : c.status === 'canceled'
              ? { label: 'Canceled', cls: 'bg-destructive' }
              : { label: 'Draft', cls: 'bg-zinc-600' }

  return (
    <div className="space-y-6">
      <Link
        href="/advertiser"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All campaigns
      </Link>

      {checkout === 'success' && (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-300">
          Payment received. Your ad is now pending review — we&apos;ll place it across screens once approved.
        </div>
      )}
      {checkout === 'canceled' && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Checkout canceled. Your campaign is saved as a draft — resume payment anytime.
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{c.ad?.title ?? 'Campaign'}</h1>
          <Badge className={statusBadge.cls}>{statusBadge.label}</Badge>
        </div>
        <CampaignControls id={c.id} status={c.status} />
      </div>

      {adStatus === 'rejected' && c.ad?.rejection_reason && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Rejected: {c.ad.rejection_reason}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {/* Creative */}
        <Card className="overflow-hidden">
          <div className="flex aspect-video items-center justify-center bg-black">
            {c.ad?.creative_url ? (
              c.ad.creative_type === 'video' ? (
                <video src={c.ad.creative_url} className="h-full w-full object-contain" controls muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.ad.creative_url} alt={c.ad.title} className="h-full w-full object-contain" />
              )
            ) : (
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <ImageOff className="size-6" />
                <span className="text-xs">Creative in production</span>
              </div>
            )}
          </div>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {locations} screen{locations === 1 ? '' : 's'}
            {c.monthly_total_cents != null && <> · {formatCents(c.monthly_total_cents)}/mo</>}
          </CardContent>
        </Card>

        {/* Analytics */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Estimated impressions / mo</p>
                  <p className="text-3xl font-semibold">{formatNumber(estImpressions)}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  from {formatNumber(estPerDayTotal)}/day across your screens
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Locations running</p>
                <p className="text-2xl font-semibold">{locations}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">QR scans · 30d</p>
                <p className="text-2xl font-semibold">{formatNumber(totalScans)}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {venues.length === 0 ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            {adStatus === 'approved' || c.status === 'active'
              ? 'Your ad is being matched to the best screens — locations and daily performance appear here once it starts running.'
              : 'Locations and daily performance appear here once your ad is approved and the campaign is active.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Where it's running */}
          {hasGeo && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <MapPin className="size-4 text-muted-foreground" />
                <h2 className="text-lg font-medium">Where it&apos;s running</h2>
              </div>
              <CampaignMap venues={mapVenues} center={venuesCenter(venues)} />
            </div>
          )}

          {/* Daily QR scans, last 30 days */}
          <Card>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Daily QR scans</p>
                  <p className="text-xs text-muted-foreground">
                    Last {PERF_WINDOW_DAYS} days · measured
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  ~{formatNumber(estPerDayTotal)} estimated impressions/day
                </p>
              </div>
              {totalScans === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No QR scans yet in the last {PERF_WINDOW_DAYS} days. Scans appear here as people
                  scan the on-screen code.
                </p>
              ) : (
                <div className="mt-4 flex h-28 items-end gap-px">
                  {series.map((d) => (
                    <div
                      key={d.date}
                      className="flex-1 rounded-t-sm bg-primary/80"
                      style={{ height: `${Math.max(2, (d.scans / maxScans) * 100)}%` }}
                      title={`${d.date}: ${d.scans} scan${d.scans === 1 ? '' : 's'}`}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Per-location breakdown */}
          <Card>
            <CardContent className="p-5">
              <p className="mb-3 text-sm font-medium">By location</p>
              <div className="space-y-2">
                {rows.map((r) => (
                  <div
                    key={r.venueId}
                    className="rounded-lg border border-border/60 px-3 py-2.5"
                  >
                    <div className="font-medium">{r.name}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        ~{formatNumber(r.estPerMonth)}{' '}
                        <span className="text-muted-foreground/70">impr/mo</span>
                      </span>
                      <span>
                        ~{formatNumber(r.estPerDay)}{' '}
                        <span className="text-muted-foreground/70">impr/day</span>
                      </span>
                      <span>
                        {formatNumber(r.scans)}{' '}
                        <span className="text-muted-foreground/70">scans · 30d</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Impressions are estimated from each venue&apos;s foot traffic. QR scans are measured.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
