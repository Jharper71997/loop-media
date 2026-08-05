import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { ExportCsvButton } from '@/components/admin/ExportCsvButton'
import { formatCents } from '@/lib/format'
import { loadAdminReports, RANGE_DAYS, DEFAULT_RANGE } from '@/lib/adminReports'
import { loadPipelineReport } from '@/lib/opportunities'
import { KIND_LABEL, sourceLabel } from '@/lib/pipeline'
import { Delta, Meter, Columns, RankedBars, CategoryRows, Funnel } from '@/components/admin/charts'
import { HudBody, StatStrip, Stat, Panel } from '@/components/admin/hud'
import { cn } from '@/lib/utils'

// The reporting HUD.
//
// Modelled on the GHL opportunity dashboard Jacob reads every week: a KPI strip
// where every number is stated against the same window immediately before it,
// then trend, mix, attribution, and a funnel that shows where inventory stops
// turning into money.
//
// The point of the funnel is that at this network's size the bottleneck is
// almost never "not enough locations" — it is spots sitting unsold on screens
// that are already installed and already lit.

const RANGE_LABEL: Record<number, string> = {
  7: '7 days',
  30: '30 days',
  90: '90 days',
  365: '12 months',
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const { range } = await searchParams

  const parsed = Number(range)
  const days = (RANGE_DAYS as readonly number[]).includes(parsed) ? parsed : DEFAULT_RANGE
  const [r, pipeline] = await Promise.all([loadAdminReports(t, days), loadPipelineReport(t, days)])

  const scope = t
    ? (territory.territories.find((x) => x.id === t)?.name ?? 'Territory')
    : 'All territories'

  const csvRows = [
    ...r.collectedByMonth.map((m) => ({
      metric: 'collected_usd',
      bucket: m.label,
      value: (m.value / 100).toFixed(2),
    })),
    ...r.spotsByMonth.map((m) => ({ metric: 'spots_placed', bucket: m.label, value: m.value })),
    ...r.scansByVenue.map((v) => ({ metric: 'scans_by_venue', bucket: v.label, value: v.value })),
    ...r.funnels.flatMap((f) =>
      f.stages.map((s) => ({ metric: `funnel_${f.title.toLowerCase()}`, bucket: s.label, value: s.value }))
    ),
  ]

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${scope} · last ${RANGE_LABEL[days]}, compared with the ${RANGE_LABEL[days]} before it`}
        action={<ExportCsvButton filename={`loop-reports-${days}d.csv`} rows={csvRows} />}
      />

      {/* Range filter — one row above the charts, per the interaction spec. */}
      <div className="flex gap-1 border-b border-border px-5 py-2 md:px-6">
        {RANGE_DAYS.map((d) => (
          <Link
            key={d}
            href={`/admin/reports?range=${d}`}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs transition-colors',
              d === days
                ? 'bg-primary/10 font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {RANGE_LABEL[d]}
          </Link>
        ))}
      </div>

      <HudBody>
        {r.sparse && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
            Barely anything happened in this window — no deals started, nothing collected, and fewer
            than 10 scans. The charts below are drawn honestly, which means mostly empty. Widen the
            range to see the shape of the year.
          </p>
        )}

        {/* ---- KPI strip ---- */}
        <StatStrip cols={6}>
          <Stat
            label="Deals started"
            value={String(r.kpis.dealsStarted.current)}
            delta={<Delta {...r.kpis.dealsStarted} />}
          />
          <Stat
            label="Went live"
            value={String(r.kpis.wentLive.current)}
            delta={<Delta {...r.kpis.wentLive} />}
          />
          <Stat
            label="MRR added"
            value={formatCents(r.kpis.mrrAdded.current)}
            delta={<Delta {...r.kpis.mrrAdded} format="money" />}
          />
          <Stat
            label="Collected"
            value={formatCents(r.kpis.collected.current)}
            delta={<Delta {...r.kpis.collected} format="money" />}
          />
          <Stat
            label="QR scans"
            value={r.kpis.scans.current.toLocaleString()}
            delta={<Delta {...r.kpis.scans} />}
          />
          <Stat
            label="Churned"
            value={String(r.kpis.churned.current)}
            delta={<Delta {...r.kpis.churned} goodDirection="down" />}
            sub="cancels only"
          />
        </StatStrip>

        {/* ---- Goal + trend ---- */}
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel title="Billed MRR vs goal" note="comps excluded">
            <Meter value={r.mrrCents} target={r.goalCents} label="Billed MRR" />
            <p className="mt-3 text-xs text-muted-foreground">
              {r.compedCents > 0
                ? `${formatCents(r.compedCents)}/mo is running comped and is deliberately not counted here.`
                : 'Nothing is running comped.'}
            </p>
          </Panel>

          <Panel title="Collected by month" note="last 12 months">
            <Columns data={r.collectedByMonth} format="money" />
          </Panel>

          <Panel title="Spots placed by month" note="last 12 months">
            <Columns data={r.spotsByMonth} />
          </Panel>
        </div>

        {/* ---- Mix + funnel ---- */}
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel title="How live accounts pay" note={`${r.billingMix.reduce((a, m) => a + m.count, 0)} live`}>
            <CategoryRows data={r.billingMix} />
            <p className="mt-3 text-xs text-muted-foreground">
              Bar length is monthly value, not headcount — a single unbilled account can outweigh
              several small paying ones.
            </p>
          </Panel>

          <Panel title="Where it stalls" note="each funnel counts one unit" className="lg:col-span-2">
            <div className="grid gap-5 sm:grid-cols-3">
              {r.funnels.map((f) => (
                <Funnel key={f.title} stages={f.stages} unit={`${f.title} · ${f.unit}`} />
              ))}
            </div>
          </Panel>
        </div>

        {/* ---- The pipeline ----
            This is the section the whole dashboard was shaped around. Until the
            opportunities table existed these questions could only be answered
            with inventory stand-ins; now they read the real board. */}
        {pipeline.ready && (
          <div className="grid gap-3 lg:grid-cols-4">
            <Panel title="Deals closed" note={`last ${RANGE_LABEL[days]}`}>
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Won</span>
                  <span className="font-mono text-lg font-semibold tabular-nums text-success">
                    {pipeline.statusCounts.won}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Lost</span>
                  <span className="font-mono text-lg font-semibold tabular-nums">
                    {pipeline.statusCounts.lost}
                  </span>
                </div>
                <div className="border-t border-border pt-2">
                  <p className="text-xs text-muted-foreground">Conversion</p>
                  <p className="font-mono text-xl font-semibold tabular-nums">
                    {pipeline.conversionPct == null ? '—' : `${pipeline.conversionPct}%`}
                  </p>
                </div>
              </div>
            </Panel>

            <Panel title="Value won vs lost" note="monthly recurring">
              <div className="space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Won</p>
                  <p className="font-mono text-xl font-semibold tabular-nums text-success">
                    {formatCents(pipeline.wonValueCents)}/mo
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Walked away</p>
                  <p className="font-mono text-lg font-semibold tabular-nums text-muted-foreground">
                    {formatCents(pipeline.lostValueCents)}/mo
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Lost value is what the objections cost. It is not revenue you had.
                </p>
              </div>
            </Panel>

            <Panel title="Open by stage" note={`${pipeline.statusCounts.open} open`}>
              {pipeline.stageCounts.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Nothing open on either board.
                </p>
              ) : (
                <div className="space-y-3">
                  {pipeline.stageCounts.map((g) => (
                    <div key={g.kind}>
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {KIND_LABEL[g.kind]}
                      </p>
                      <RankedBars data={g.stages} emptyText="None open." />
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Where deals come from" note="won in this window">
              <RankedBars
                data={pipeline.bySource.map((s) => ({
                  label: `${sourceLabel(s.label === 'unknown' ? null : s.label)} · ${s.open} open`,
                  value: s.won,
                }))}
                emptyText="Nothing closed yet, so there is no attribution to show."
              />
            </Panel>
          </div>
        )}

        {/* ---- Attribution ---- */}
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="Scans by location" note={`last ${RANGE_LABEL[days]}`}>
            <RankedBars
              data={r.scansByVenue}
              emptyText="No scans recorded on any screen in this window."
            />
          </Panel>

          <Panel title="Scans by hour" note={r.timeZone.replace('_', ' ')}>
            <Columns data={r.scansByHour} height={80} />
            <p className="mt-2 text-xs text-muted-foreground">
              Local time. Peak hours are the argument for what a spot is worth at a given venue.
            </p>
          </Panel>
        </div>
      </HudBody>
    </>
  )
}
