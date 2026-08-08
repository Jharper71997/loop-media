import Link from 'next/link'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatCents } from '@/lib/format'
import { SEVERITY_LABEL, type Severity } from '@/lib/caseTypes'

// The frame every case page shares.
//
// A case page has one job: prove the problem, then hand you the fix. It always
// reads in the same order — the verdict, the evidence behind it, the data the
// evidence came from, and the things you can do about it — so you learn the
// shape once and never have to re-learn it on a page you visit under pressure.

const TONE: Record<Severity, 'destructive' | 'warning' | 'default' | 'secondary'> = {
  critical: 'destructive',
  warning: 'warning',
  opening: 'default',
  task: 'secondary',
}

export function CaseShell({
  severity,
  title,
  verdict,
  moneyCents,
  moneyNote,
  children,
}: {
  severity: Severity
  title: string
  /** The problem in one sentence, in plain words. */
  verdict: string
  moneyCents?: number
  moneyNote?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4 p-3 md:p-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Today
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
            <Badge variant={TONE[severity]}>{SEVERITY_LABEL[severity]}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{verdict}</p>
        </div>
        {!!moneyCents && (
          <div className="shrink-0 text-right">
            <div className="font-mono text-2xl font-semibold tabular-nums">
              {formatCents(moneyCents)}
            </div>
            <div className="text-[11px] text-muted-foreground">{moneyNote}</div>
          </div>
        )}
      </div>

      {children}
    </div>
  )
}

export function CaseSection({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {title}
        </h2>
        {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
      </div>
      {children}
    </section>
  )
}

/** One measured (or clearly-labelled estimated) figure with its meaning under it. */
export function Evidence({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note?: string
  tone?: 'bad' | 'warn' | 'good'
}) {
  return (
    <div className="min-w-0 bg-card px-3 py-2.5">
      <p className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={
          'mt-0.5 truncate font-mono text-xl font-semibold tabular-nums tracking-tight ' +
          (tone === 'bad'
            ? 'text-destructive'
            : tone === 'warn'
              ? 'text-warning'
              : tone === 'good'
                ? 'text-success'
                : '')
        }
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-[10px] text-muted-foreground">{note}</p>}
    </div>
  )
}

export function EvidenceGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
      {children}
    </div>
  )
}

/** A thing to do about it. Reads as an instruction, never as a page name. */
export function CaseAction({
  href,
  label,
  detail,
  external,
}: {
  href: string
  label: string
  detail: string
  external?: boolean
}) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </>
  )
  const cls =
    'flex items-center gap-3 border-border px-3 py-2.5 transition-colors hover:bg-muted/50'
  return external ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  )
}

export function CaseActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {children}
    </div>
  )
}
