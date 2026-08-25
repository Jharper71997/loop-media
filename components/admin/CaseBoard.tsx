'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { formatCents, timeAgo } from '@/lib/format'
import { SEVERITY_LABEL, SEVERITY_RANK, type Case, type Severity } from '@/lib/caseTypes'
import type { Dismissal } from '@/lib/caseTypes'
import { DataTable, type Column, type SavedView } from '@/components/admin/DataTable'
import { SnoozeCase, RestoreCase } from '@/components/admin/SnoozeCase'
import { cn } from '@/lib/utils'

// The board: every open problem, one row each, ranked.
//
// A row has to answer three things before you click it — what is wrong, what it
// is costing, and how long it has been like that. Anything that cannot answer
// all three is a link, not a case.
//
// This is a feed, not a grid: the row is a designed object (severity dot, title,
// age, summary, money, clear button) and chopping it into table cells would make
// the one page that already works worse. So it runs DataTable in `renderRow`
// mode — same views, search, sorting, keyboard and URL state as every other list
// in the admin, its own row. The columns below exist only to declare what can be
// sorted and exported; none of them is rendered.
//
// SNOOZED CASES RIDE ALONG in the same list rather than sitting in a second
// component below it. They have to be somewhere — a clear that really deletes is
// a clear nobody dares use — but they are not open work, so every view except
// "Snoozed" filters them out and the counts stay honest.

type BoardCase = Case & { dismissal?: Dismissal }

const DOT: Record<Severity, string> = {
  critical: 'bg-destructive',
  warning: 'bg-warning',
  opening: 'bg-primary',
  task: 'bg-muted-foreground/40',
}

const MONEY_TONE: Record<Severity, string> = {
  critical: 'text-destructive',
  warning: 'text-warning',
  opening: 'text-primary',
  task: 'text-muted-foreground',
}

const COLUMNS: Column<BoardCase>[] = [
  { key: 'money', header: 'Money', cell: () => null, value: (c) => c.moneyCents, numeric: true },
  { key: 'severity', header: 'Worst first', cell: () => null, value: (c) => SEVERITY_RANK[c.severity] },
  // Sorting ascending on this is "open longest", which is the question you ask
  // when deciding what has been ignored too long.
  { key: 'since', header: 'Age', cell: () => null, value: (c) => c.since },
  { key: 'title', header: 'Name', cell: () => null, value: (c) => c.title },
]

const live = (c: BoardCase) => !c.dismissal

const VIEWS: SavedView<BoardCase>[] = [
  { id: 'all', label: 'Everything', match: live },
  {
    id: 'critical',
    label: SEVERITY_LABEL.critical,
    match: (c) => live(c) && c.severity === 'critical',
    tone: 'bad',
  },
  {
    id: 'warning',
    label: SEVERITY_LABEL.warning,
    match: (c) => live(c) && c.severity === 'warning',
    tone: 'warn',
  },
  { id: 'opening', label: SEVERITY_LABEL.opening, match: (c) => live(c) && c.severity === 'opening' },
  { id: 'task', label: SEVERITY_LABEL.task, match: (c) => live(c) && c.severity === 'task' },
  { id: 'snoozed', label: 'Snoozed', match: (c) => !!c.dismissal },
]

/** "back in 6 days" / "back if it changes" — a snooze has to say when it ends. */
function returnsIn(d: Dismissal): string {
  if (!d.until) return 'back if it changes'
  const days = Math.round((new Date(d.until).getTime() - Date.now()) / 86_400_000)
  if (days <= 0) return 'back today'
  return `back in ${days} day${days === 1 ? '' : 's'}`
}

export function CaseBoard({ cases, snoozed = [] }: { cases: Case[]; snoozed?: BoardCase[] }) {
  const rows: BoardCase[] = [...cases, ...snoozed]

  return (
    <DataTable
      rows={rows}
      rowId={(c) => c.id}
      columns={COLUMNS}
      views={VIEWS}
      href={(c) => c.href}
      defaultSort={{ key: 'money', dir: 'desc' }}
      searchable={(c) => `${c.title} ${c.summary}`}
      searchPlaceholder="Filter by business or problem…"
      emptyTitle="Nothing is broken, nothing is owed, and nothing is waiting on you."
      csvFilename="loop-open-problems.csv"
      csvRow={(c) => ({
        problem: c.kind,
        severity: c.severity,
        subject: c.title,
        detail: c.summary,
        monthly_usd: (c.moneyCents / 100).toFixed(2),
        open_since: c.since ? c.since.slice(0, 10) : '',
        snoozed: c.dismissal ? returnsIn(c.dismissal) : '',
      })}
      renderRow={(c) => (
        <div className={cn('flex items-center gap-1 pr-1', c.dismissal && 'opacity-55')}>
          <Link
            href={c.href}
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 hover:bg-muted/50 md:py-2.5"
          >
            <span className={cn('size-1.5 shrink-0 rounded-full', DOT[c.severity])} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium">{c.title}</span>
                {c.since && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {timeAgo(c.since)}
                  </span>
                )}
              </div>
              {/* Wraps on a phone instead of truncating: the summary IS the
                  evidence, and half of it is not evidence. */}
              <p className="line-clamp-2 text-xs text-muted-foreground md:truncate">{c.summary}</p>
              {c.dismissal && (
                <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                  Snoozed · {returnsIn(c.dismissal)}
                  {c.dismissal.reason ? ` · ${c.dismissal.reason}` : ''}
                </p>
              )}
            </div>
            {c.moneyCents > 0 && (
              <div className="shrink-0 text-right">
                <div className={cn('font-mono text-sm tabular-nums', MONEY_TONE[c.severity])}>
                  {formatCents(c.moneyCents)}
                </div>
                <div className="hidden text-[10px] text-muted-foreground sm:block">{c.moneyNote}</div>
              </div>
            )}
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
          {c.dismissal ? <RestoreCase caseId={c.id} label={c.title} /> : <SnoozeCase c={c} />}
        </div>
      )}
    />
  )
}
