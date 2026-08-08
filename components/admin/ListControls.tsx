'use client'

import { Search, ArrowUpDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// The filter bar every admin list shares.
//
// Sorting used to be whatever order the query came back in, which meant the
// screen that had been dark longest and the one that went dark ten minutes ago
// sat in the same undifferentiated list. Sorting is presented as a plain row of
// choices rather than a dropdown: on a list you scan every day, the option you
// want should be one click, and you should be able to see what the current order
// even is without opening anything.
//
// Presentational only — the parent owns the data and the comparators, so a list
// can sort by anything it understands (money, last seen, age) without this file
// knowing about any of it.

export type SortOption = { value: string; label: string }
export type FilterOption = { value: string; label: string; count?: number }

export function ListControls({
  query,
  onQuery,
  placeholder = 'Filter…',
  sorts,
  sort,
  onSort,
  filters,
  activeFilters,
  onToggleFilter,
  right,
}: {
  query: string
  onQuery: (v: string) => void
  placeholder?: string
  sorts: SortOption[]
  sort: string
  onSort: (v: string) => void
  /** Optional chips. Selecting none means "show everything". */
  filters?: FilterOption[]
  activeFilters?: string[]
  onToggleFilter?: (v: string) => void
  right?: React.ReactNode
}) {
  const active = activeFilters ?? []
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={placeholder}
            className="h-9 pl-9"
          />
        </div>
        {right}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <ArrowUpDown className="mr-0.5 size-3.5 shrink-0 text-muted-foreground" />
          {sorts.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onSort(s.value)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                sort === s.value
                  ? 'bg-primary/15 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {!!filters?.length && (
          <div className="flex flex-wrap items-center gap-1">
            {filters.map((f) => {
              const on = active.includes(f.value)
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => onToggleFilter?.(f.value)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    on
                      ? 'border-foreground/25 bg-foreground/10 font-medium text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {f.label}
                  {f.count != null && <span className="ml-1 tabular-nums opacity-60">{f.count}</span>}
                </button>
              )
            })}
            {active.length > 0 && (
              <button
                type="button"
                onClick={() => active.forEach((v) => onToggleFilter?.(v))}
                className="px-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                clear
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
