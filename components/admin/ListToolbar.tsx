'use client'

import { Search, ArrowUpDown, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ExportCsvButton } from '@/components/admin/ExportCsvButton'
import type { useListState } from '@/components/admin/useListState'
import type { BulkAction } from '@/components/admin/DataTable'
import { cn } from '@/lib/utils'

// The controls above every list, in Shopify's order: saved views, then search,
// then sort, then export. When rows are selected the whole bar is REPLACED by the
// bulk actions rather than pushing them onto a new line — the selection is the
// only thing you care about at that moment, and a bar that grows a second row
// shifts the table under the pointer you are still selecting with.
//
// Sorting is a visible row of pills, not a dropdown. On a list you scan every day
// the order you want should be one click, and you should be able to see what the
// current order is without opening anything. (This doctrine came from the old
// ListControls, which is the one thing about it that was right.)

type ViewChip = { id: string; label: string; count: number; tone?: 'bad' | 'warn' }

export function ListToolbar({
  list,
  placeholder,
  searchable,
  views,
  sorts,
  selectedCount,
  bulkActions,
  onBulk,
  onClearSelection,
  bulkPending,
  csv,
  right,
}: {
  list: ReturnType<typeof useListState>
  placeholder: string
  searchable: boolean
  views?: ViewChip[]
  sorts: { key: string; label: string }[]
  selectedCount: number
  bulkActions?: BulkAction[]
  onBulk: (a: BulkAction) => void
  onClearSelection: () => void
  bulkPending: boolean
  csv?: { filename: string; rows: Record<string, string | number>[] }
  right?: React.ReactNode
}) {
  if (selectedCount > 0 && bulkActions?.length) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
        <span className="text-sm font-medium tabular-nums">
          {selectedCount} selected
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {bulkActions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant={a.destructive ? 'destructive' : 'outline'}
              disabled={bulkPending}
              onClick={() => onBulk(a)}
            >
              {a.label}
            </Button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClearSelection}
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" /> Clear
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {!!views?.length && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-1.5">
          {views.map((v) => {
            const on = list.view === v.id
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => list.setView(v.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors',
                  on
                    ? 'bg-primary/15 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {v.label}
                <span
                  className={cn(
                    'tabular-nums',
                    on ? 'opacity-70' : 'opacity-50',
                    !on && v.tone === 'bad' && v.count > 0 && 'font-medium text-destructive opacity-100',
                    !on && v.tone === 'warn' && v.count > 0 && 'font-medium text-warning opacity-100'
                  )}
                >
                  {v.count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={list.draftQ}
              onChange={(e) => list.setQ(e.target.value)}
              placeholder={placeholder}
              className="h-9 pl-9"
            />
          </div>
        )}
        {right}
        {csv && <ExportCsvButton filename={csv.filename} rows={csv.rows} />}
      </div>

      {sorts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <ArrowUpDown className="mr-0.5 size-3.5 shrink-0 text-muted-foreground" />
          {sorts.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => list.setSort(s.key)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs transition-colors',
                list.sort === s.key
                  ? 'bg-primary/15 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {s.label}
              {list.sort === s.key && (list.dir === 'asc' ? ' ↑' : ' ↓')}
            </button>
          ))}
          {list.isFiltered && (
            <button
              type="button"
              onClick={list.clearAll}
              className="ml-1 px-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
