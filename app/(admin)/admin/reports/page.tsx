import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { ExportCsvButton } from '@/components/admin/ExportCsvButton'
import { formatCents } from '@/lib/format'
import { loadAdminReports, RANGE_DAYS, DEFAULT_RANGE } from '@/lib/adminReports'
import { loadPipelineReport } from '@/lib/opportunities'
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

        {/* ---- Pipeline, in one line ----
            The full opportunity dashboard lives at /admin/pipeline/dashboard.
            Repeating it here would mean two screens showing the same numbers and
            eventually disagreeing, so this is a pointer, not a copy. */}
        {pipeline.ready && (
          <Panel
            title="Pipeline"
            action={
              <Link
                href="/admin/pipeline/dashboard"
                className="text-[11px] text-primary hover:underline"
              >
                Full dashboard ›
              </Link>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <PipelineStat
                label="Open"
                value={String(pipeline.statusCounts.open)}
                sub="deals being worked"
              />
              <PipelineStat
                label="Won"
                value={String(pipeline.statusCounts.won)}
                sub={`${formatCents(pipeline.wonValueCents)}/mo added`}
                tone="good"
              />
              <PipelineStat
                label="Lost"
                value={String(pipeline.statusCounts.lost)}
                sub={`${formatCents(pipeline.lostValueCents)}/mo walked`}
              />
              <PipelineStat
                label="Conversion"
                value={pipeline.conversionPct == null ? '—' : `${pipeline.conversionPct}%`}
                sub="of what closed"
              />
            </div>
          </Panel>
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

function PipelineStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: 'good'
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          'font-mono text-xl font-semibold tabular-nums',
          tone === 'good' && 'text-success'
        )}
      >
        {value}
      </p>
      <p className="truncate text-[10px] text-muted-foreground">{sub}</p>
    </div>
  )
}
