import Link from 'next/link'
import {
  ArrowLeft,
  ChevronRight,
  CheckCircle2,
  CreditCard,
  Mail,
  Megaphone,
  FileText,
  WifiOff,
  MonitorPlay,
  StickyNote,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatCents, formatDateTime, timeAgo } from '@/lib/format'
import { SEVERITY_LABEL, type Severity } from '@/lib/caseTypes'
import type { Case } from '@/lib/caseTypes'
import type { ActivityEvent, ActivityKind } from '@/lib/activity'
import { cn } from '@/lib/utils'

// The one record page.
//
// Three shells existed before this — cards on the advertiser page, different
// cards on venues and screens, the HUD panels on the pipeline record — and a
// fourth on the case pages. None of them had tabs, only one had any history, and
// none linked to the others, so an "advertiser" was five pages keyed by three
// different ids with no path between them.
//
// The frame is GoHighLevel's, because that is the admin already in Jacob's
// hands: identity and actions up top, a verdict, tabs down the middle, and a
// rail on the right for the facts you glance at rather than read. Tabs live in
// the URL (`?tab=`) rather than client state, so a tab is linkable, the back
// button steps through them, and a heavy tab does not have to load when you are
// looking at a different one.

export type RecordTab = { id: string; label: string; count?: number }

export function RecordShell({
  backHref,
  backLabel,
  title,
  subtitle,
  badges,
  actions,
  verdict,
  tabs,
  activeTab,
  basePath,
  rail,
  children,
}: {
  backHref: string
  backLabel: string
  title: string
  subtitle?: React.ReactNode
  badges?: React.ReactNode
  actions?: React.ReactNode
  verdict?: React.ReactNode
  tabs: RecordTab[]
  activeTab: string
  /** Tab links are `${basePath}?tab=<id>`. */
  basePath: string
  rail?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4 p-3 md:p-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> {backLabel}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
            {badges}
          </div>
          {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {verdict}

      <div className="-mb-px flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => {
          const active = t.id === activeTab
          return (
            <Link
              key={t.id}
              href={t.id === tabs[0].id ? basePath : `${basePath}?tab=${t.id}`}
              className={cn(
                'flex shrink-0 items-center gap-2 border-b-2 px-2.5 py-1.5 text-[13px] transition-colors',
                active
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
              {!!t.count && (
                <span className="min-w-5 rounded-full bg-primary/15 px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums text-primary">
                  {t.count}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      <div className={cn('grid gap-4', rail && 'lg:grid-cols-3')}>
        <div className={cn('min-w-0 space-y-4', rail && 'lg:col-span-2')}>{children}</div>
        {rail && <div className="min-w-0 space-y-3">{rail}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The verdict block
// ---------------------------------------------------------------------------

const TONE: Record<Severity, { bar: string; text: string }> = {
  critical: { bar: 'border-destructive/30 bg-destructive/10', text: 'text-destructive' },
  warning: { bar: 'border-warning/30 bg-warning/10', text: 'text-warning' },
  opening: { bar: 'border-primary/30 bg-primary/10', text: 'text-primary' },
  task: { bar: 'border-border bg-muted/40', text: 'text-muted-foreground' },
}

/** What is wrong with this record, or a plain statement that nothing is. */
export function RecordVerdict({
  cases,
  moneyCents,
  healthyLine,
}: {
  cases: Case[]
  moneyCents: number
  /** Shown when there are no open cases. Say something true, never "All good".  */
  healthyLine: string
}) {
  if (!cases.length) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        <p className="text-sm text-muted-foreground">{healthyLine}</p>
      </div>
    )
  }
  const worst = cases[0].severity
  const tone = TONE[worst]
  return (
    <div className={cn('overflow-hidden rounded-lg border', tone.bar)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 pt-2.5">
        <span className={cn('text-[11px] font-medium uppercase tracking-widest', tone.text)}>
          {SEVERITY_LABEL[worst]} · {cases.length} open
        </span>
        {moneyCents > 0 && (
          <span className={cn('font-mono text-sm font-semibold tabular-nums', tone.text)}>
            {formatCents(moneyCents)}/mo
          </span>
        )}
      </div>
      <div className="mt-1.5 divide-y divide-border/50">
        {cases.map((c) => (
          <Link
            key={c.id}
            href={c.href}
            className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-background/40"
          >
            <span className="min-w-0 flex-1 text-sm">{c.summary}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

export function RailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

/** Label/value line for the rail. Empty values are dropped, not shown blank. */
export function RailFact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '' || value === false) return null
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  payment: CreditCard,
  message: Mail,
  ad: Megaphone,
  campaign: MonitorPlay,
  report: FileText,
  alert: WifiOff,
  placement: MonitorPlay,
  note: StickyNote,
}

const ACTIVITY_TONE: Partial<Record<ActivityKind, string>> = {
  payment: 'text-success',
  alert: 'text-destructive',
}

export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  if (!events.length) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        Nothing recorded against this yet.
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <ul className="divide-y divide-border">
        {events.map((e, i) => {
          const Icon = ACTIVITY_ICON[e.kind]
          return (
            <li key={i} className="flex items-start gap-3 px-3 py-2.5">
              <Icon className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground', ACTIVITY_TONE[e.kind])} />
              <div className="min-w-0 flex-1">
                <div className="text-sm">{e.title}</div>
                {e.detail && (
                  <p className="truncate text-xs text-muted-foreground">{e.detail}</p>
                )}
              </div>
              <span
                className="shrink-0 text-[11px] text-muted-foreground"
                title={formatDateTime(e.at)}
              >
                {timeAgo(e.at)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
