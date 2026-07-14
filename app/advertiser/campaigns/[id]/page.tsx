import { notFound } from 'next/navigation'
import { ImageOff, MapPin } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasUnlimitedChanges } from '@/lib/membership'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ScanLocked } from '@/components/app/ScanLocked'
import { formatNumber, formatCents } from '@/lib/format'
import type { Ad, Campaign } from '@/lib/db.types'
import {
  dailySeries,
  locationRows,
  venuesCenter,
  measuredPlaysTotal,
  estImpressionsPerMonth,
  PERF_WINDOW_DAYS,
  type RunningVenue,
  type ScanRow,
} from '@/lib/analytics'
import { isWithinOpenHours } from '@/lib/openHours'
import { CampaignControls } from './CampaignControls'
import { BackLink } from './BackLink'
import { ReplaceCreative } from './ReplaceCreative'
import { MembershipUpsell } from './MembershipUpsell'
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
  searchParams: Promise<{ checkout?: string; change?: string }>
}) {
  const profile = await requireProfile()
  const { id } = await params
  const { checkout, change } = await searchParams
  const supabase = await createClient()

  const { data } = await supabase
    .from('campaigns')
    .select('*, ad:ads(*), package:packages(name, base_price_cents)')
    .eq('id', id)
    .maybeSingle()
  if (!data) notFound()
  const c = data as unknown as CampaignFull

  // Non-members see the unlimited-changes upsell next to the creative swap; the
  // host shell stays $-free, so the upsell is advertiser-only.
  const showUpsell =
    !!c.ad_id &&
    c.status !== 'canceled' &&
    profile.role !== 'host' &&
    !(await hasUnlimitedChanges(createAdminClient(), profile.id))

  // QR scan proof is free for every advertiser (Insights now sells demographics + strategy).
  const showScans = true

  const { data: placementsData } = await supabase
    .from('ad_placements')
    .select(
      'id, tv:tvs(id, venue:venues(id, name, lat, lng, foot_traffic_estimate, median_daily_customers, business_open, business_close, business_days, business_hours))'
    )
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
        median_daily_customers: number | null
        business_open: string | null
        business_close: string | null
        business_days: number[] | null
        business_hours: Record<string, { open: string; close: string }> | null
      } | null
    } | null
  }
  const placements = (placementsData ?? []) as unknown as PRow[]

  // Distinct running venues + the screens at each (one venue can host several TVs).
  const venueMap = new Map<string, RunningVenue>()
  const tvToVenueId = new Map<string, string>()
  // Per-tv open-hours (for filtering ad_plays exactly like the admin TV page).
  const tvOpenHours = new Map<
    string,
    {
      business_open: string | null
      business_close: string | null
      business_days: number[] | null
      business_hours: Record<string, { open: string; close: string }> | null
    }
  >()
  for (const p of placements) {
    const v = p.tv?.venue
    const tvId = p.tv?.id
    if (!v || !tvId) continue
    tvToVenueId.set(tvId, v.id)
    tvOpenHours.set(tvId, {
      business_open: v.business_open,
      business_close: v.business_close,
      business_days: v.business_days,
      business_hours: v.business_hours,
    })
    const existing = venueMap.get(v.id)
    if (existing) existing.tvIds.push(tvId)
    else {
      venueMap.set(v.id, {
        venueId: v.id,
        name: v.name,
        lat: v.lat,
        lng: v.lng,
        footTraffic: v.foot_traffic_estimate ?? 0,
        medianDailyCustomers: v.median_daily_customers ?? null,
        tvIds: [tvId],
        plays: 0,
      })
    }
  }
  // Demo: no real placements exist (a demo ad never airs). Populate "where it's
  // running" from the screens the advertiser actually picked (campaign_targets),
  // so the finish lands on a real map of their chosen venues.
  if (c.is_demo && venueMap.size === 0) {
    const { data: tgt } = await supabase
      .from('campaign_targets')
      .select('venue:venues(id, name, lat, lng, foot_traffic_estimate, median_daily_customers)')
      .eq('campaign_id', id)
    for (const row of (tgt ?? []) as unknown as {
      venue: {
        id: string
        name: string
        lat: number | null
        lng: number | null
        foot_traffic_estimate: number
        median_daily_customers: number | null
      } | null
    }[]) {
      const v = row.venue
      if (!v || venueMap.has(v.id)) continue
      venueMap.set(v.id, {
        venueId: v.id,
        name: v.name,
        lat: v.lat,
        lng: v.lng,
        footTraffic: v.foot_traffic_estimate ?? 0,
        medianDailyCustomers: v.median_daily_customers ?? null,
        tvIds: [],
        plays: 0,
      })
    }
  }

  const venues = [...venueMap.values()]
  const runningTvIds = venues.flatMap((v) => v.tvIds)

  // Measured QR scans over the reporting window (attributed to a screen + day).
  let scans: ScanRow[] = []
  if (c.ad_id) {
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - PERF_WINDOW_DAYS)
    const { data: scanData } = await supabase
      .from('qr_scans')
      .select('tv_id, scanned_at')
      .eq('ad_id', c.ad_id)
      .eq('is_bot', false)
      .gte('scanned_at', since.toISOString())
    scans = (scanData ?? []) as ScanRow[]
  }

  // Measured "times shown" from proof-of-play. Open-hours filtered per screen so a
  // play at 3am with the TV left on isn't counted as an impression (matches the
  // admin screen page). Attributed back to the venue and attached to RunningVenue.
  if (c.ad_id && runningTvIds.length) {
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - PERF_WINDOW_DAYS)
    const { data: playData } = await supabase
      .from('ad_plays')
      .select('tv_id, played_at')
      .eq('ad_id', c.ad_id)
      .in('tv_id', runningTvIds)
      .gte('played_at', since.toISOString())
    const playsByVenue = new Map<string, number>()
    for (const p of (playData ?? []) as { tv_id: string; played_at: string }[]) {
      const hours = tvOpenHours.get(p.tv_id)
      if (hours && !isWithinOpenHours(p.played_at, hours)) continue
      const vid = tvToVenueId.get(p.tv_id)
      if (!vid) continue
      playsByVenue.set(vid, (playsByVenue.get(vid) ?? 0) + 1)
    }
    for (const v of venues) v.plays = playsByVenue.get(v.venueId) ?? 0
  }

  const locations = venues.length
  const totalScans = scans.length
  const totalPlays = measuredPlaysTotal(venues)
  const estReach = estImpressionsPerMonth(venues)

  const series = dailySeries(venues, scans)
  const rows = locationRows(venues, scans)
  const maxScans = Math.max(1, ...series.map((d) => d.scans))
  const mapVenues: CampaignMapVenue[] = rows.map((r) => {
    const v = venueMap.get(r.venueId)!
    return { id: r.venueId, name: r.name, lat: v.lat, lng: v.lng, footTraffic: r.estPerMonth, scans: r.scans }
  })
  const hasGeo = mapVenues.some((v) => v.lat != null && v.lng != null)

  const adStatus = c.ad?.status
  // Status → design-system Badge variant (no raw palette classes).
  const statusBadge =
    adStatus === 'rejected'
      ? { label: 'Rejected', variant: 'destructive' as const }
      : adStatus === 'pending'
        ? { label: 'Pending review', variant: 'warning' as const }
        : c.status === 'active'
          ? { label: 'Active', variant: 'success' as const }
          : c.status === 'paused'
            ? { label: 'Paused', variant: 'secondary' as const }
            : c.status === 'canceled'
              ? { label: 'Canceled', variant: 'destructive' as const }
              : { label: 'Draft', variant: 'secondary' as const }

  const firstVenueName = venues[0]?.name ?? null
  const isLive = c.status === 'active' && (adStatus === 'approved' || adStatus === 'active')

  return (
    <div className="space-y-6">
      <BackLink />

      {checkout === 'success' && (
        <div className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          Payment received. Your ad is now pending review — we&apos;ll place it across screens once approved.
        </div>
      )}
      {checkout === 'canceled' && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Checkout canceled. Your campaign is saved as a draft — resume payment anytime.
        </div>
      )}
      {change === 'success' && (
        <div className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          Payment received. Your new creative is pending review and replaces the current one once approved.
        </div>
      )}
      {change === 'canceled' && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Change canceled. Your current creative keeps running and you were not charged.
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{c.ad?.title ?? 'Campaign'}</h1>
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        </div>
        <CampaignControls id={c.id} status={c.status} />
      </div>

      {adStatus === 'rejected' && c.ad?.rejection_reason && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Rejected: {c.ad.rejection_reason}
        </div>
      )}

      <div className="space-y-6">
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
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">
              {locations} screen{locations === 1 ? '' : 's'}
              {/* Hide the price on the host shell — hosts shouldn't see amounts
                  that could read as network revenue (the figure is their own
                  spend, but the rule is no $ on host surfaces). */}
              {c.monthly_total_cents != null && profile.role !== 'host' && (
                <> · {formatCents(c.monthly_total_cents)}/mo</>
              )}
            </p>
            {c.ad_id && c.status !== 'canceled' && (
              <ReplaceCreative
                campaignId={c.id}
                userId={profile.id}
                qrTargetUrl={c.ad?.qr_target_url}
                qrX={c.ad?.qr_x}
                qrY={c.ad?.qr_y}
                qrSize={c.ad?.qr_size}
              />
            )}
            {showUpsell && <MembershipUpsell />}
          </CardContent>
        </Card>

        {/* Performance summary — measured QR scans lead; reach is a clearly-labeled
            estimate; nothing is repeated three times like before. */}
        <Card>
          <CardContent className="space-y-4 p-5">
            {isLive && (
              <div className="flex items-center gap-2 text-sm">
                <span className="size-2 shrink-0 rounded-full bg-success" />
                <span className="font-medium">
                  Live on {locations} screen{locations === 1 ? '' : 's'}
                  {locations === 1 && firstVenueName ? ` at ${firstVenueName}` : ''}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="Times shown"
                sub={`measured · ${PERF_WINDOW_DAYS}d`}
                value={totalPlays}
                accent
              />
              {showScans ? (
                <Stat label="QR scans" sub={`measured · ${PERF_WINDOW_DAYS}d`} value={totalScans} accent />
              ) : (
                <ScanLocked variant="stat" label="QR scans" />
              )}
              <Stat label="Screens" sub="live" value={locations} />
              {estReach > 0 && (
                <Stat label="Est. reach" sub="monthly · estimate" value={estReach} />
              )}
            </div>
          </CardContent>
        </Card>
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
              <CampaignMap venues={mapVenues} center={venuesCenter(venues)} showScans={showScans} />
            </div>
          )}

          {/* Daily QR scans — only once there's something to plot (no empty chart). */}
          {showScans && totalScans > 0 && (
            <Card>
              <CardContent className="p-5">
                <p className="text-sm font-medium">Daily QR scans</p>
                <p className="text-xs text-muted-foreground">
                  Last {PERF_WINDOW_DAYS} days · measured
                </p>
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
              </CardContent>
            </Card>
          )}

          {/* Per-location breakdown — only with more than one screen (a single
              location just repeats the summary above). */}
          {locations > 1 && (
            <Card>
              <CardContent className="p-5">
                <p className="mb-3 text-sm font-medium">By location</p>
                <div className="space-y-2">
                  {rows.map((r) => (
                    <div
                      key={r.venueId}
                      className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 rounded-lg border border-border/60 px-3 py-2.5"
                    >
                      <span className="font-medium">{r.name}</span>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {formatNumber(r.plays)}{' '}
                          <span className="text-muted-foreground/70">shown · 30d</span>
                        </span>
                        {showScans && (
                          <span>
                            {formatNumber(r.scans)}{' '}
                            <span className="text-muted-foreground/70">scans · 30d</span>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            {showScans
              ? 'Times shown and QR scans are both measured on the screens themselves, counted only during each venue’s open hours. Reach is an estimate from venue foot traffic.'
              : 'Times shown is measured on the screens themselves, counted only during each venue’s open hours. Reach is an estimate from venue foot traffic.'}
          </p>
        </div>
      )}
    </div>
  )
}

// Compact metric for the performance summary. The measured one (QR scans) gets
// the gold accent; estimates stay neutral.
function Stat({
  label,
  sub,
  value,
  accent,
}: {
  label: string
  sub: string
  value: number
  accent?: boolean
}) {
  return (
    <div className="space-y-0.5">
      <p
        className={`font-heading text-2xl font-bold tabular-nums ${accent ? 'text-primary' : ''}`}
      >
        {formatNumber(value)}
      </p>
      <p className="text-xs font-medium">{label}</p>
      <p className="text-[0.7rem] text-muted-foreground">{sub}</p>
    </div>
  )
}
