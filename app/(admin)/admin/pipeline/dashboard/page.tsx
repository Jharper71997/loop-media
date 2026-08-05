import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getTerritoryContext } from '@/lib/territory'
import { PageHeader } from '@/components/admin/PageHeader'
import { ExportCsvButton } from '@/components/admin/ExportCsvButton'
import { HudBody, StatStrip, Stat, Panel } from '@/components/admin/hud'
import { Delta, GroupedColumns, RankedBars, CategoryRows, Funnel } from '@/components/admin/charts'
import { formatCents } from '@/lib/format'
import { loadPipelineDashboard } from '@/lib/opportunities'
import { KIND_LABEL, sourceLabel, type OpportunityKind } from '@/lib/pipeline'
import { PipelineTabs } from '../PipelineTabs'
import { cn } from '@/lib/utils'

// The opportunity dashboard.
//
// This is the GHL screen Jacob reads, rebuilt in this network's units: counts
// against the same window immediately before them, opened vs won over time,
// where new opportunities ended up, attribution by source with the revenue it
// actually produced, a stage funnel, and what is sitting in each stage now.
//
// Two deliberate differences from GHL:
//
//   * Value is MONTHLY. GHL shows a one-off deal size; every number in this
//     business is recurring, so "won value" here reads as MRR added and rolls up
//     to the $4k goal rather than being a separate universe of dollars.
//   * The funnel is reconstructed from the EVENT LOG — how many opportunities
//     ever reached each stage — not from where cards sit today. Reading current
//     stage would erase every deal that has already closed and would show a deal
//     that jumped straight to Proposal as never having been Contacted.

const RANGES = [30, 90, 365] as const
const RANGE_LABEL: Record<number, string> = {
  30: '30 days',
  90: '90 days',
  365: '12 months',
}

export default async function PipelineDashboard({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; range?: string }>
}) {
  const profile = await requireAdmin()
  const territory = await getTerritoryContext(profile)
  const t = territory.activeId
  const { kind: kindParam, range } = await searchParams
  const kind: OpportunityKind = kindParam === 'host' ? 'host' : 'advertiser'

  const parsed = Number(range)
  const days = (RANGES as readonly number[]).includes(parsed) ? parsed : 30
  const d = await loadPipelineDashboard(t, days)

  const scope = t
    ? (territory.territories.find((x) => x.id === t)?.name ?? 'Territory')
    : 'All markets'

  const funnel = d.funnels.find((f) => f.kind === kind)
  const stageNow = d.stageNow.find((g) => g.kind === kind)

  const csvRows = [
    ...d.overTime.map((m) => ({ metric: 'created', bucket: m.label, value: m.created })),
    ...d.overTime.map((m) => ({ metric: 'won', bucket: m.label, value: m.won })),
    ...d.bySource.map((s) => ({
      metric: 'source_won_usd',
      bucket: sourceLabel(s.key === 'unknown' ? null : s.key),
      value: (s.cents / 100).toFixed(2),
    })),
  ]

  return (
    <>
      <PageHeader
        title="Pipeline dashboard"
        description={`${scope} · last ${RANGE_LABEL[days]}, against the ${RANGE_LABEL[days]} before it`}
        action={<ExportCsvButton filename={`loop-pipeline-${days}d.csv`} rows={csvRows} />}
      />
      <PipelineTabs kind={kind} />

      <div className="flex gap-1 border-b border-border px-3 py-1.5 md:px-4">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/admin/pipeline/dashboard?kind=${kind}&range=${r}`}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs transition-colors',
              r === days
                ? 'bg-primary/10 font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {RANGE_LABEL[r]}
          </Link>
        ))}
      </div>

      <HudBody>
        {!d.ready ? (
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
            <div className="space-y-1">
              <p className="font-medium">The pipeline tables have not been created yet.</p>
              <p className="text-muted-foreground">
                Paste{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  loop-run-this-in-supabase.sql
                </code>{' '}
                (on your Desktop) into the Supabase SQL editor and reload.
              </p>
            </div>
          </div>
        ) : (
          <>
            {d.sparse && (
              <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
                There are almost no opportunities yet, so everything below is drawn honestly —
                which means mostly empty.{' '}
                <Link href="/admin/pipeline/import" className="text-primary hover:underline">
                  Import a list
                </Link>{' '}
                and this fills in.
              </p>
            )}

            {/* ---- The headline row ---- */}
            <StatStrip cols={6}>
              <Stat
                label="Opportunities"
                value={d.opportunities.current.toLocaleString()}
                delta={<Delta {...d.opportunities} />}
                sub="everything ever added"
              />
              <Stat
                label="Opened"
                value={String(d.opened.current)}
                delta={<Delta {...d.opened} />}
                sub={`new in ${RANGE_LABEL[days]}`}
              />
              <Stat
                label="Won"
                value={String(d.won.current)}
                delta={<Delta {...d.won} />}
                tone={d.won.current > 0 ? 'good' : undefined}
              />
              <Stat
                label="Lost"
                value={String(d.lost.current)}
                delta={<Delta {...d.lost} goodDirection="down" />}
              />
              <Stat
                label="Won value"
                value={`${formatCents(d.wonValueCents.current)}/mo`}
                delta={<Delta {...d.wonValueCents} format="money" />}
                title="Monthly recurring value of deals won in this window. This is what moves the $4k goal."
              />
              <Stat
                label="Conversion"
                value={d.conversionPct == null ? '—' : `${d.conversionPct}%`}
                sub={
                  d.conversionPct == null
                    ? 'nothing closed yet'
                    : d.avgDaysToWin != null
                      ? `${d.avgDaysToWin} days to close`
                      : 'of what closed'
                }
                title="Won divided by everything that closed in this window. Open deals are excluded — they have not decided."
              />
            </StatStrip>

            {/* ---- Over time + where they ended up ---- */}
            <div className="grid gap-3 lg:grid-cols-3">
              <Panel title="Opened vs won" note="last 12 months" className="lg:col-span-2">
                <GroupedColumns
                  data={d.overTime.map((m) => ({ label: m.label, a: m.created, b: m.won }))}
                  aLabel="Opened"
                  bLabel="Won"
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Both series count opportunities, so they share one scale. A tall opened bar with
                  no won bar beside it three months later is the pattern worth chasing.
                </p>
              </Panel>

              <Panel title="Where this window's new ones went" note={`${d.opened.current} opened`}>
                {d.opened.current === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Nothing new in this window.
                  </p>
                ) : (
                  <CategoryRows
                    weight="count"
                    data={d.byStatus.map((s) => ({
                      label: s.label,
                      count: s.count,
                      // Unused when weight is 'count'; the bar is sized by count.
                      cents: 0,
                      slot: s.slot,
                    }))}
                  />
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Bar length is the count, not money — this is about how many decided, not what
                  they were worth.
                </p>
              </Panel>
            </div>

            {/* ---- Funnel + stage distribution ---- */}
            <div className="grid gap-3 lg:grid-cols-3">
              <Panel
                title={`${KIND_LABEL[kind]} funnel`}
                note="ever reached each stage"
                className="lg:col-span-2"
              >
                {!funnel || funnel.stages.every((s) => s.value === 0) ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Nothing in this pipeline yet.
                  </p>
                ) : (
                  <>
                    <Funnel stages={funnel.stages} unit="Opportunities" />
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Counted from the activity log, so a deal that has already closed still shows
                      in the stages it passed through. The biggest drop is where the pitch is
                      failing.
                    </p>
                  </>
                )}
              </Panel>

              <Panel title="Open right now" note={`${d.openCount} across both boards`}>
                {!stageNow ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Nothing open in {KIND_LABEL[kind].toLowerCase()}.
                  </p>
                ) : (
                  <RankedBars data={stageNow.stages} emptyText="Nothing open." />
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {formatCents(d.openValueCents)}/mo sitting open across every stage.
                </p>
              </Panel>
            </div>

            {/* ---- Attribution ---- */}
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Revenue by source" note={`won in ${RANGE_LABEL[days]}`}>
                <RankedBars
                  data={d.bySource
                    .filter((s) => s.cents > 0)
                    .map((s) => ({
                      label: sourceLabel(s.key === 'unknown' ? null : s.key),
                      value: s.cents,
                    }))}
                  format="money"
                  emptyText="Nothing has closed yet, so there is no revenue to attribute."
                />
              </Panel>

              <Panel title="Every source" note="all time" bodyClassName="p-0">
                {d.bySource.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No opportunities yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-1.5 text-left font-medium">Source</th>
                          <th className="px-2 py-1.5 text-right font-medium">Total</th>
                          <th className="px-2 py-1.5 text-right font-medium">Won</th>
                          <th className="px-2 py-1.5 text-right font-medium">Lost</th>
                          <th className="px-3 py-1.5 text-right font-medium">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.bySource.map((s) => (
                          <tr key={s.key} className="border-b border-border last:border-b-0">
                            <td className="max-w-40 truncate px-3 py-1.5">
                              {sourceLabel(s.key === 'unknown' ? null : s.key)}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                              {s.count}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-success">
                              {s.won || '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                              {s.lost || '—'}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                              {s.cents > 0 ? `${formatCents(s.cents)}/mo` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>

            {/* ---- What it cost to lose ---- */}
            {d.lostValueCents > 0 && (
              <p className="px-1 text-[11px] text-muted-foreground">
                {formatCents(d.lostValueCents)}/mo walked away in this window. That is not revenue
                you had — it is the size of the objections worth answering.
              </p>
            )}
          </>
        )}
      </HudBody>
    </>
  )
}
