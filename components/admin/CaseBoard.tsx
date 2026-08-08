'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, CheckCircle2 } from 'lucide-react'
import { formatCents, timeAgo } from '@/lib/format'
import { SEVERITY_LABEL, SEVERITY_RANK, type Case, type Severity } from '@/lib/caseTypes'
import { ListControls } from '@/components/admin/ListControls'
import { cn } from '@/lib/utils'

// The board: every open problem, one row each, ranked.
//
// A row has to answer three things before you click it — what is wrong, what it
// is costing, and how long it has been like that. Anything that cannot answer
// all three is a link, not a case.

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

const SORTS = [
  { value: 'money', label: 'Biggest money' },
  { value: 'worst', label: 'Worst first' },
  { value: 'oldest', label: 'Open longest' },
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'A–Z' },
]

// Nulls last in both directions: a case with no start date has no age to rank.
function byAge(a: Case, b: Case, dir: 1 | -1) {
  if (!a.since && !b.since) return 0
  if (!a.since) return 1
  if (!b.since) return -1
  return dir * a.since.localeCompare(b.since)
}

export function CaseBoard({ cases }: { cases: Case[] }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('money')
  const [active, setActive] = useState<string[]>([])

  const filters = useMemo(() => {
    const order: Severity[] = ['critical', 'warning', 'opening', 'task']
    return order
      .map((s) => ({
        value: s,
        label: SEVERITY_LABEL[s],
        count: cases.filter((c) => c.severity === s).length,
      }))
      .filter((f) => f.count > 0)
  }, [cases])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = cases.filter((c) => {
      if (active.length && !active.includes(c.severity)) return false
      if (!q) return true
      return c.title.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q)
    })
    out.sort((a, b) => {
      switch (sort) {
        case 'worst':
          return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.moneyCents - a.moneyCents
        case 'oldest':
          return byAge(a, b, 1) || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
        case 'newest':
          return byAge(a, b, -1) || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
        case 'name':
          return a.title.localeCompare(b.title)
        default:
          return (
            b.moneyCents - a.moneyCents || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
          )
      }
    })
    return out
  }, [cases, query, sort, active])

  return (
    <div className="space-y-3">
      <ListControls
        query={query}
        onQuery={setQuery}
        placeholder="Filter by business or problem…"
        sorts={SORTS}
        sort={sort}
        onSort={setSort}
        filters={filters}
        activeFilters={active}
        onToggleFilter={(v) =>
          setActive((xs) => (xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]))
        }
      />

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-14 text-center">
          <CheckCircle2 className="size-6 text-success" />
          <p className="text-sm text-muted-foreground">
            {cases.length === 0
              ? 'Nothing is broken, nothing is owed, and nothing is waiting on you.'
              : 'Nothing matches that filter.'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {shown.map((c) => (
            <Link
              key={c.id}
              href={c.href}
              className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
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
                <p className="truncate text-xs text-muted-foreground">{c.summary}</p>
              </div>
              {c.moneyCents > 0 && (
                <div className="shrink-0 text-right">
                  <div className={cn('font-mono text-sm tabular-nums', MONEY_TONE[c.severity])}>
                    {formatCents(c.moneyCents)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{c.moneyNote}</div>
                </div>
              )}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
