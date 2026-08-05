import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

// Chart primitives for the admin reporting HUD.
//
// Hand-rolled inline SVG on purpose: the project has no chart dependency, these
// are all simple magnitude forms, and server-rendered SVG means the numbers are
// in the HTML — no loading state, no client bundle, and it prints.
//
// Colour is referenced by ROLE (--viz-*, defined in app/globals.css) and never
// as raw hex, so light/dark swap in one place. See that block for why the app's
// status tokens are deliberately NOT used as a chart palette.
//
// Every mark carries a <title>, which browsers render as a native hover tooltip
// — the per-mark hover layer, with no JS and no hydration cost.

const money = (cents: number) =>
  cents >= 100_000
    ? `$${Math.round(cents / 100_000) / 10}k`
    : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`

// ---------------------------------------------------------------------------
// Delta — "vs previous period", the thing the GHL dashboard leads with.
// ---------------------------------------------------------------------------

// Deliberately shows the raw previous value too. A bare "+140%" off a base of 1
// is noise, and at this network's size that happens constantly.
export function Delta({
  current,
  previous,
  format = 'number',
  // For most metrics up is good; for churn and overdue it is the opposite.
  goodDirection = 'up',
}: {
  current: number
  previous: number
  format?: 'number' | 'money'
  goodDirection?: 'up' | 'down'
}) {
  const fmt = (n: number) => (format === 'money' ? money(n) : n.toLocaleString())
  const diff = current - previous
  const pct = previous > 0 ? Math.round((diff / previous) * 100) : null
  const flat = diff === 0
  const good = flat ? null : goodDirection === 'up' ? diff > 0 : diff < 0
  const Icon = flat ? Minus : diff > 0 ? ArrowUp : ArrowDown

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs tabular-nums',
        flat && 'text-muted-foreground',
        good === true && 'text-success',
        good === false && 'text-destructive'
      )}
      title={`This period ${fmt(current)} · previous ${fmt(previous)}`}
    >
      <Icon className="size-3" aria-hidden />
      {pct == null ? fmt(Math.abs(diff)) : `${Math.abs(pct)}%`}
      <span className="text-muted-foreground">vs {fmt(previous)}</span>
    </span>
  )
}

// The hero-number tile (Stat) and the titled box (Panel) live in
// components/admin/hud.tsx — they are page chrome, used on pages with no chart
// on them at all, and keeping them here would make every page import "charts"
// to draw a box.

// ---------------------------------------------------------------------------
// Meter — one value against a target. A bar, not a gauge: gauges waste space
// and are read less accurately than a straight line.
// ---------------------------------------------------------------------------

export function Meter({
  value,
  target,
  label,
}: {
  value: number
  target: number
  label: string
}) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-heading text-2xl font-bold tabular-nums">{money(value)}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {pct}% of {money(target)}
        </p>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full"
        style={{ background: 'var(--viz-track)' }}
        role="img"
        aria-label={`${label}: ${money(value)} of ${money(target)}, ${pct} percent`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: 'var(--viz-mag)' }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Columns — change over time, one series.
// ---------------------------------------------------------------------------

export type Point = { label: string; value: number; hint?: string }

export function Columns({
  data,
  format = 'number',
  height = 96,
}: {
  data: Point[]
  format?: 'number' | 'money'
  height?: number
}) {
  const fmt = (n: number) => (format === 'money' ? money(n) : n.toLocaleString())
  const max = Math.max(1, ...data.map((d) => d.value))
  if (data.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No data in this range.</p>
  }

  // Geometry in a viewBox so it scales to any container width. 2px gap between
  // adjacent bars (the surface spacer), 4px rounded data-end at the top only.
  const W = 300
  const gap = 2
  const bw = (W - gap * (data.length - 1)) / data.length

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={data.map((d) => `${d.label} ${fmt(d.value)}`).join(', ')}
      >
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * (height - 2))
          return (
            <rect
              key={i}
              x={i * (bw + gap)}
              y={height - h}
              width={bw}
              height={h}
              rx={Math.min(4, bw / 2)}
              fill="var(--viz-mag)"
            >
              <title>{`${d.label}: ${fmt(d.value)}${d.hint ? ` · ${d.hint}` : ''}`}</title>
            </rect>
          )
        })}
      </svg>
      {/* Selective labels only — first, peak, last. A number on every column is
          noise at 12 points and unreadable at 24. */}
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span className="tabular-nums">peak {fmt(max)}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GroupedColumns — two series over the same time axis (opportunities created vs
// won). Side-by-side bars, ONE shared y-scale: both series count the same unit,
// so a second axis would be a lie about their relative size. This is the chart
// the dual-axis rule exists to prevent.
//
// Two series means a legend is mandatory, which also discharges the light-mode
// contrast warning on categorical slot 3.
// ---------------------------------------------------------------------------

export function GroupedColumns({
  data,
  aLabel,
  bLabel,
  height = 96,
}: {
  data: { label: string; a: number; b: number }[]
  aLabel: string
  bLabel: string
  height?: number
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No data in this range.</p>
  }
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]))
  const W = 300
  const groupGap = 3
  const barGap = 1
  const gw = (W - groupGap * (data.length - 1)) / data.length
  const bw = (gw - barGap) / 2

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: 'var(--viz-cat-1)' }} aria-hidden />
          {aLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: 'var(--viz-cat-3)' }} aria-hidden />
          {bLabel}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={data.map((d) => `${d.label}: ${aLabel} ${d.a}, ${bLabel} ${d.b}`).join('; ')}
      >
        {data.map((d, i) => {
          const x = i * (gw + groupGap)
          const ha = Math.max(d.a > 0 ? 2 : 0, (d.a / max) * (height - 2))
          const hb = Math.max(d.b > 0 ? 2 : 0, (d.b / max) * (height - 2))
          return (
            <g key={i}>
              <rect
                x={x}
                y={height - ha}
                width={bw}
                height={ha}
                rx={Math.min(3, bw / 2)}
                fill="var(--viz-cat-1)"
              >
                <title>{`${d.label} · ${aLabel}: ${d.a}`}</title>
              </rect>
              <rect
                x={x + bw + barGap}
                y={height - hb}
                width={bw}
                height={hb}
                rx={Math.min(3, bw / 2)}
                fill="var(--viz-cat-3)"
              >
                <title>{`${d.label} · ${bLabel}: ${d.b}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span className="tabular-nums">peak {max}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// RankedBars — magnitude across named things (scans per venue). Horizontal so
// the names are readable without rotating text.
// ---------------------------------------------------------------------------

export function RankedBars({
  data,
  format = 'number',
  emptyText = 'Nothing recorded yet.',
}: {
  data: Point[]
  format?: 'number' | 'money'
  emptyText?: string
}) {
  const fmt = (n: number) => (format === 'money' ? money(n) : n.toLocaleString())
  if (data.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>
  }
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <ul className="space-y-1.5">
      {data.map((d, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs">{d.label}</span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full"
              style={{ background: 'var(--viz-track)' }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${(d.value / max) * 100}%`, background: 'var(--viz-mag)' }}
                title={`${d.label}: ${fmt(d.value)}`}
              />
            </div>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{fmt(d.value)}</span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// CategoryRows — the billing mix. Identity, so this is the ONE place a
// categorical palette is used; every row is direct-labelled, which is also what
// discharges the light-mode contrast WARN on slot 3.
// ---------------------------------------------------------------------------

export type Category = { label: string; count: number; cents: number; slot: 1 | 2 | 3 }

// `weight` says what the bar LENGTH means. 'money' is the billing mix, where a
// single expensive account should outweigh several cheap ones. 'count' is for
// sets where money is not the point (how this month's new opportunities ended
// up) — passing counts through the cents field would otherwise print "9 · $0.09".
export function CategoryRows({
  data,
  weight = 'money',
  emptyText = 'Nothing here yet.',
}: {
  data: Category[]
  weight?: 'money' | 'count'
  emptyText?: string
}) {
  const value = (d: Category) => (weight === 'money' ? d.cents : d.count)
  const total = Math.max(1, data.reduce((a, d) => a + value(d), 0))
  if (data.every((d) => d.count === 0)) {
    return <p className="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>
  }
  return (
    <ul className="space-y-2.5">
      {data.map((d) => {
        const readout =
          weight === 'money' ? `${d.count} · ${money(d.cents)}/mo` : String(d.count)
        const tooltip =
          weight === 'money'
            ? `${d.label}: ${d.count} accounts, ${money(d.cents)}/mo`
            : `${d.label}: ${d.count} (${Math.round((d.count / total) * 100)}%)`
        return (
          <li key={d.label}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: `var(--viz-cat-${d.slot})` }}
                  aria-hidden
                />
                {d.label}
              </span>
              <span className="tabular-nums text-muted-foreground">{readout}</span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full"
              style={{ background: 'var(--viz-track)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(value(d) / total) * 100}%`,
                  background: `var(--viz-cat-${d.slot})`,
                }}
                title={tooltip}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Funnel — where inventory stalls. Each stage is a share of the FIRST stage, so
// the bars are comparable; the drop-off is labelled because that is the finding.
// ---------------------------------------------------------------------------

export type Stage = { label: string; value: number; note?: string }

// One funnel = ONE unit. Stages are drawn as a share of the first stage, which
// is only meaningful if every stage counts the same kind of thing. Mixing
// locations and ad spots in a single funnel makes "198 spots" and "9 locations"
// draw the same full-width bar — so the caller passes several small funnels
// instead, each internally consistent. `unit` is shown so that is explicit.
export function Funnel({ stages, unit }: { stages: Stage[]; unit?: string }) {
  const top = Math.max(1, stages[0]?.value ?? 1)
  return (
    <ul className="space-y-2">
      {unit && (
        <li className="pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {unit}
        </li>
      )}
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null
        const dropped = prev != null ? prev - s.value : 0
        return (
          <li key={s.label}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span>{s.label}</span>
              <span className="tabular-nums">
                {s.value.toLocaleString()}
                {prev != null && dropped > 0 && (
                  <span className="ml-2 text-muted-foreground">−{dropped.toLocaleString()}</span>
                )}
              </span>
            </div>
            <div
              className="mt-1 h-2 overflow-hidden rounded-full"
              style={{ background: 'var(--viz-track)' }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${(s.value / top) * 100}%`, background: 'var(--viz-mag)' }}
                title={`${s.label}: ${s.value.toLocaleString()}${s.note ? ` · ${s.note}` : ''}`}
              />
            </div>
            {s.note && <p className="mt-0.5 text-[10px] text-muted-foreground">{s.note}</p>}
          </li>
        )
      })}
    </ul>
  )
}
