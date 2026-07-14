import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatNumber, formatCents } from '@/lib/format'
import type { CampaignReport } from '@/lib/reports'

// The beautiful, shareable ROI report — one presentation-grade view reused by the
// advertiser's in-app report page and the public /report/[id] link they send to a
// partner. Pure server component (no hooks); charts are inline SVG so it prints
// cleanly and needs no chart library. `publicView` hides anything private (spend)
// so a link the advertiser forwards never leaks billing.
export function CampaignReportView({
  report: r,
  publicView = false,
}: {
  report: CampaignReport
  publicView?: boolean
}) {
  const scanTotal = r.dailyScans.reduce((s, d) => s + d.scans, 0)
  const showTrend = r.showScans && r.dailyScans.length > 1 && scanTotal > 0
  const topLocations = r.locations.slice(0, 8)
  const maxPlays = Math.max(1, ...topLocations.map((l) => l.plays))
  const maxTypePlays = Math.max(1, ...r.byVenueType.map((t) => t.plays))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Masthead */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.15em] text-primary">
            Loop Network
          </div>
          <h1 className="mt-1.5 font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            {r.adTitle}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{r.period.label} performance report</p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {r.locationsCount} screen{r.locationsCount === 1 ? '' : 's'}
        </Badge>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Times shown" sub="measured" value={formatNumber(r.totalPlays)} accent />
        {r.showScans && (
          <Kpi label="QR scans" sub="measured" value={formatNumber(r.totalScans)} accent />
        )}
        <Kpi label="Est. reach" sub="monthly estimate" value={formatNumber(r.estImpressions)} />
        {r.showScans && r.scansPer1000 != null ? (
          <Kpi label="Scans / 1,000" sub="shown" value={formatNumber(r.scansPer1000)} />
        ) : (
          <Kpi label="Screens" sub="running" value={formatNumber(r.locationsCount)} />
        )}
      </div>

      {/* Scan trend */}
      {showTrend && (
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Daily QR scans</p>
                <p className="text-xs text-muted-foreground">{r.period.label} &middot; measured</p>
              </div>
              <p className="text-xs text-muted-foreground">{formatNumber(scanTotal)} total</p>
            </div>
            <ScanAreaChart points={r.dailyScans} />
          </CardContent>
        </Card>
      )}

      {/* Top locations */}
      {topLocations.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <p className="mb-4 text-sm font-semibold">Where it played</p>
            <div className="space-y-3">
              {topLocations.map((loc) => (
                <div key={loc.venueId}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{loc.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatNumber(loc.plays)} shown
                      {r.showScans ? ` · ${formatNumber(loc.scans)} scans` : ''}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/80"
                      style={{ width: `${Math.max(3, (loc.plays / maxPlays) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Venue-type mix */}
      {r.byVenueType.length > 1 && r.totalPlays > 0 && (
        <Card>
          <CardContent className="p-5">
            <p className="mb-4 text-sm font-semibold">What kind of places</p>
            <div className="space-y-3">
              {r.byVenueType.map((t) => (
                <div key={t.type} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm">{t.type}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/60"
                      style={{ width: `${Math.max(3, (t.plays / maxTypePlays) * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {formatNumber(t.plays)} shown
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Wins strip: exclusivity + owner-only investment */}
      {(r.exclusiveCount > 0 || (!publicView && r.monthlyTotalCents != null)) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {r.exclusiveCount > 0 && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <p className="text-sm font-semibold">Category locked down</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  You own your category exclusively at {r.exclusiveCount} venue
                  {r.exclusiveCount === 1 ? '' : 's'} — competitors can&apos;t run there.
                </p>
              </CardContent>
            </Card>
          )}
          {!publicView && r.monthlyTotalCents != null && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-semibold">{formatCents(r.monthlyTotalCents)}/mo</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Your investment across {r.locationsCount} screen
                  {r.locationsCount === 1 ? '' : 's'}.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Methodology */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {r.showScans
          ? 'Times shown and QR scans are measured on the screens themselves, counted only during each venue’s open hours. '
          : 'Times shown is measured on the screens themselves, counted only during each venue’s open hours. '}
        Estimated reach comes from each venue’s typical daily customers. Numbers reflect the
        screens this ad ran on during {r.period.label}.
      </p>

      {/* Public footer / CTA */}
      {publicView && (
        <div className="rounded-xl border border-border bg-card/60 p-5 text-center">
          <p className="text-sm font-semibold">Want your business on local screens?</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Loop Network puts your ad on TVs in real local spots, and shows you exactly how it
            performs — measured plays and scans, not guesses.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Link
              href="/preview"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              See your ad on a TV
            </Link>
            <Link
              href="/signup"
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
            >
              Start advertising
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({
  label,
  sub,
  value,
  accent,
}: {
  label: string
  sub: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
      <p className={`font-heading text-2xl font-bold tabular-nums ${accent ? 'text-primary' : ''}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs font-medium">{label}</p>
      <p className="text-[0.7rem] text-muted-foreground">{sub}</p>
    </div>
  )
}

// Inline SVG area chart for daily scans. Fixed viewBox, scaled by CSS — crisp on
// screen and in print. Uses the theme's primary color via currentColor.
function ScanAreaChart({ points }: { points: { date: string; scans: number }[] }) {
  const W = 720
  const H = 160
  const padX = 4
  const padY = 12
  const n = points.length
  const max = Math.max(1, ...points.map((p) => p.scans))
  const innerW = W - padX * 2
  const innerH = H - padY * 2
  const x = (i: number) => padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padY + innerH - (v / max) * innerH

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.scans).toFixed(1)}`).join(' ')
  const area = `${line} L ${x(n - 1).toFixed(1)} ${(H - padY).toFixed(1)} L ${x(0).toFixed(1)} ${(H - padY).toFixed(1)} Z`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-40 w-full text-primary"
      role="img"
      aria-label="Daily QR scans trend"
    >
      <defs>
        <linearGradient id="scanFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#scanFill)" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
