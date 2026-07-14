import Link from 'next/link'
import { Plus, BarChart3 } from 'lucide-react'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { MoneyStat } from '@/components/app/MoneyStat'
import { ScanLocked } from '@/components/app/ScanLocked'
import { InsightsUpsell } from '@/components/app/InsightsUpsell'
import { AudienceInsights } from '@/components/app/AudienceInsights'
import { formatCents, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  dailySeries,
  locationRows,
  PERF_WINDOW_DAYS,
  type RunningVenue,
  type ScanRow,
} from '@/lib/analytics'

// Portfolio-wide performance across ALL of the signed-in buyer's active campaigns.
// Shared by the advertiser (/advertiser/results) and the host (/host/results) —
// a host advertises under their own profile id, so the exact same query
// (campaigns.advertiser_id = profile.id) returns their own campaigns. `browseHref`
// points the empty-state CTA at the right buy flow for each surface.
export async function ResultsView({ browseHref }: { browseHref: string }) {
  const profile = await requireProfile()
  const supabase = await createClient()

  const { data: campsData } = await supabase
    .from('campaigns')
    .select('id, monthly_total_cents, ad:ads(id)')
    .eq('advertiser_id', profile.id)
    .eq('status', 'active')
    .is('deleted_at', null)
  type CampRow = { id: string; monthly_total_cents: number | null; ad: { id: string } | null }
  const camps = (campsData ?? []) as unknown as CampRow[]
  const campaignIds = camps.map((c) => c.id)
  const spend = camps.reduce((s, c) => s + (c.monthly_total_cents ?? 0), 0)
  const adIds = [...new Set(camps.map((c) => c.ad?.id).filter(Boolean) as string[])]

  // eslint-disable-next-line react-hooks/purity -- server component; per-request timestamp is correct here
  const cutoff = new Date(Date.now() - PERF_WINDOW_DAYS * 86_400_000).toISOString()
  const [placementsRes, scansRes] = await Promise.all([
    campaignIds.length
      ? supabase
          .from('ad_placements')
          .select('tv:tvs(id, venue:venues(id, name, lat, lng, foot_traffic_estimate, median_daily_customers))')
          .in('campaign_id', campaignIds)
          .eq('status', 'active')
      : Promise.resolve({ data: [] as unknown[] }),
    adIds.length
      ? supabase.from('qr_scans').select('tv_id, scanned_at').in('ad_id', adIds).eq('is_bot', false).gte('scanned_at', cutoff)
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  type PRow = {
    tv: {
      id: string
      venue: {
        id: string
        name: string
        lat: number | null
        lng: number | null
        foot_traffic_estimate: number
        median_daily_customers: number | null
      } | null
    } | null
  }
  const byVenue = new Map<string, RunningVenue>()
  for (const p of (((placementsRes as { data: unknown[] }).data ?? []) as PRow[])) {
    const v = p.tv?.venue
    if (!v) continue
    const e: RunningVenue =
      byVenue.get(v.id) ?? {
        venueId: v.id,
        name: v.name,
        lat: v.lat,
        lng: v.lng,
        footTraffic: v.foot_traffic_estimate ?? 0,
        medianDailyCustomers: v.median_daily_customers ?? null,
        tvIds: [],
      }
    if (p.tv?.id && !e.tvIds.includes(p.tv.id)) e.tvIds.push(p.tv.id)
    byVenue.set(v.id, e)
  }
  const venues = [...byVenue.values()]
  const scans = (((scansRes as { data: unknown[] }).data ?? []) as ScanRow[])

  const series = dailySeries(venues, scans)
  const rows = locationRows(venues, scans)
  const totalScans = scans.length
  const maxScans = Math.max(1, ...series.map((d) => d.scans))

  const hasData = venues.length > 0
  // QR scan proof is free for every advertiser — undeniable ROI is the whole point.
  // (The Insights membership now sells audience demographics + strategy, not scans.)
  const showScans = true

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Results</h1>
        <p className="text-sm text-muted-foreground">
          How your advertising is performing across every screen.
        </p>
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-primary/10">
              <BarChart3 className="size-6 text-primary" />
            </span>
            <p className="max-w-xs text-sm text-muted-foreground">
              Once a campaign is live, your scans and best-performing locations show up here.
            </p>
            <Link href={browseHref} className={cn(buttonVariants(), 'h-11')}>
              <Plus className="size-4" /> Start a campaign
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
              <MoneyStat label="Locations" value={formatNumber(venues.length)} />
            </div>
            {showScans ? (
              <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
                <MoneyStat label={`Scans · ${PERF_WINDOW_DAYS}d`} value={formatNumber(totalScans)} />
              </div>
            ) : (
              <ScanLocked variant="tile" label={`Scans · ${PERF_WINDOW_DAYS}d`} />
            )}
            <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
              <MoneyStat label="Spend / mo" value={formatCents(spend)} />
            </div>
          </div>

          {showScans ? (
            <>
              {/* Daily QR scans — measured */}
              <Card>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">Daily QR scans</p>
                      <p className="text-xs text-muted-foreground">Last {PERF_WINDOW_DAYS} days · measured</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{formatNumber(totalScans)} total</p>
                  </div>
                  {totalScans === 0 ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                      No scans yet. They appear here as people scan the on-screen code on your ad.
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

              {/* Best-performing locations */}
              <section className="space-y-3">
                <h2 className="font-heading text-lg font-semibold">Top locations</h2>
                <Card className="py-0">
                  <CardContent className="divide-y divide-border p-0">
                    {rows.map((r) => (
                      <div key={r.venueId} className="px-4 py-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate font-medium">{r.name}</span>
                          <span className="shrink-0 font-heading text-lg font-bold tabular-nums">
                            {formatNumber(r.scans)}
                            <span className="ml-1 text-xs font-normal text-muted-foreground">scans</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <p className="text-xs text-muted-foreground">
                  QR scans are measured — each one is a real person who scanned your on-screen code.
                </p>
              </section>
            </>
          ) : (
            <InsightsUpsell />
          )}

          {/* Audience demographics teaser (Quividi moat) — coming soon. */}
          <AudienceInsights />
        </>
      )}
    </div>
  )
}
