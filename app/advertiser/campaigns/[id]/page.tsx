import { notFound } from 'next/navigation'
import { ImageOff, MapPin } from 'lucide-react'
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
import {
  summarizeUptime,
  venueBusinessHours,
  formatUptimePct,
  UPTIME_WINDOW_DAYS,
} from '@/lib/uptime'
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

  // Does this advertiser hold the unlimited-changes membership? (RLS scopes the
  // memberships table to their own rows.) Drives whether a creative swap is free.
  const { data: membership } = await supabase
    .from('memberships')
    .select('current_period_end')
    .eq('kind', 'unlimited_changes')
    .eq('status', 'active')
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()
  const isMember =
    !!membership &&
    (!membership.current_period_end ||
      new Date(membership.current_period_end).getTime() >= Date.now())

  const { data: placementsData } = await supabase
    .from('ad_placements')
    .select(
      'id, tv:tvs(id, venue:venues(id, name, lat, lng, foot_traffic_estimate, business_open, business_close, business_days))'
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
        business_open: string | null
        business_close: string | null
        business_days: number[] | null
      } | null
    } | null
  }
  const placements = (placementsData ?? []) as unknown as PRow[]

  // Distinct running venues + the screens at each (one venue can host several TVs).
  const venueMap = new Map<string, RunningVenue>()
  const venueHours = new Map<string, ReturnType<typeof venueBusinessHours>>()
  for (const p of placements) {
    const v = p.tv?.venue
    const tvId = p.tv?.id
    if (!v || !tvId) continue
    const existing = venueMap.get(v.id)
    if (existing) existing.tvIds.push(tvId)
    else {
      venueMap.set(v.id, {
        venueId: v.id,
        name: v.name,
        lat: v.lat,
        lng: v.lng,
        footTraffic: v.foot_traffic_estimate ?? 0,
        tvIds: [tvId],
      })
      venueHours.set(v.id, venueBusinessHours(v))
    }
  }
  const venues = [...venueMap.values()]

  // Uptime over the last 30 days for the screens this ad runs on (RLS lets the
  // advertiser read uptime for their own placements). Per venue: aggregate its
  // screens' measured + expected seconds, then a venue is "below SLA" if short.
  const runningTvIds = venues.flatMap((v) => v.tvIds)
  const uptimeByVenue = new Map<string, { pct: number; breach: boolean; hasData: boolean }>()
  if (runningTvIds.length) {
    const upSince = new Date()
    upSince.setUTCDate(upSince.getUTCDate() - UPTIME_WINDOW_DAYS)
    const { data: upData } = await supabase
      .from('tv_uptime_days')
      .select('tv_id, day, seconds')
      .in('tv_id', runningTvIds)
      .gte('day', upSince.toISOString().slice(0, 10))
    const byTv = new Map<string, { day: string; seconds: number }[]>()
    for (const r of (upData ?? []) as { tv_id: string; day: string; seconds: number }[]) {
      const list = byTv.get(r.tv_id) ?? []
      list.push({ day: r.day, seconds: r.seconds })
      byTv.set(r.tv_id, list)
    }
    for (const v of venues) {
      const bh = venueHours.get(v.venueId) ?? venueBusinessHours({})
      const rows = v.tvIds.flatMap((id) => byTv.get(id) ?? [])
      const s = summarizeUptime(rows, bh)
      uptimeByVenue.set(v.venueId, { pct: s.pct, breach: s.breach, hasData: s.hasData })
    }
  }
  const breachedVenues = venues.filter((v) => uptimeByVenue.get(v.venueId)?.breach).length

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
      <BackLink />

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
      {change === 'success' && (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-300">
          Payment received. Your new creative is pending review and replaces the current one once approved.
        </div>
      )}
      {change === 'canceled' && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Change canceled. Your current creative keeps running and you were not charged.
        </div>
      )}
      {breachedVenues > 0 && (
        <div className="rounded-lg border border-amber-600/40 bg-amber-600/10 px-4 py-3 text-sm text-amber-300">
          {breachedVenues} of your screen{breachedVenues === 1 ? '' : 's'} ran below our 80%
          uptime guarantee this month. We&apos;re on it, and we&apos;ll make it right.
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
              <ReplaceCreative campaignId={c.id} userId={profile.id} isMember={isMember} />
            )}
            {c.ad_id && c.status !== 'canceled' && !isMember && <MembershipUpsell />}
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
                      {(() => {
                        const u = uptimeByVenue.get(r.venueId)
                        if (!u || !u.hasData) return null
                        return (
                          <span className={u.breach ? 'text-amber-400' : ''}>
                            {formatUptimePct(u.pct)}{' '}
                            <span className="text-muted-foreground/70">uptime · 30d</span>
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Ad views are an estimate of how many times your ad is seen. QR scans are measured.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
