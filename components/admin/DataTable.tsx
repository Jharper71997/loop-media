'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/admin/EmptyState'
import { ListToolbar } from '@/components/admin/ListToolbar'
import { useListState } from '@/components/admin/useListState'
import { cn } from '@/lib/utils'

// The one list.
//
// The admin had ten ways to render a collection of records — a shadcn Table on
// three pages, three hand-rolled <table>s, eight `<ul className="divide-y">`s,
// six `<div className="divide-y">`s, four card stacks, a card grid, a Kanban, and
// a duplicated mobile-cards/desktop-table pair. None of them sorted, none of them
// paged, one of them could be filtered, and no two of them agreed on what an
// empty state looks like. That is the single biggest reason the admin does not
// read as one product.
//
// Everything a list can do lives here: saved views, search, sorting, selection,
// bulk actions, CSV of what you are actually looking at, paging, keyboard, and
// one empty state. Every filter is mirrored into the URL by useListState, so a
// filtered list is a link you can send yourself and the back button works.
//
// TWO RENDERERS, one system. Most lists are a grid of columns. A few — the Today
// board especially — are a ranked feed whose row is a designed object, not a set
// of cells. Pass `renderRow` and you get the feed; pass `columns` and you get the
// grid. They share every behaviour above so a feed and a grid cannot drift apart,
// which is exactly how the admin ended up with ten of these in the first place.
//
// Filtering and sorting happen in the browser. That is a deliberate limit, not an
// oversight: several of these lists are assembled in JS (billing health comes out
// of resolveBilling, cases out of loadCases, inventory out of loadInventory) and
// have no SQL equivalent to push the work into. At this size — 12 venues, 14
// screens, a few dozen advertisers — the whole set is smaller than the page that
// renders it. Revisit when one list clears a couple of thousand rows.

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  /** Sort/CSV value. Sorting is disabled for a column without one. */
  value?: (row: T) => string | number | null
  /** Right-aligned and mono, per the hud doctrine for figures. */
  numeric?: boolean
  /** Drop the column below this breakpoint instead of duplicating the whole list for mobile. */
  hideBelow?: 'sm' | 'md' | 'lg'
  className?: string
}

/** A named filter, the way a GHL smart list works: a live predicate, not a snapshot. */
export type SavedView<T> = {
  id: string
  label: string
  match: (row: T) => boolean
  tone?: 'bad' | 'warn'
}

export type BulkAction = {
  label: string
  /** Shown before running. Destructive actions should always set this. */
  confirm?: (n: number) => string
  destructive?: boolean
  run: (ids: string[]) => Promise<{ error: string | null }>
}

const HIDE_BELOW: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
}

export function DataTable<T>({
  rows,
  rowId,
  columns,
  renderRow,
  href,
  views,
  searchable,
  bulkActions,
  csvRow,
  csvFilename,
  emptyTitle = 'Nothing here yet',
  emptyHint,
  searchPlaceholder = 'Search…',
  pageSize = 50,
  defaultSort,
  toolbarRight,
}: {
  rows: T[]
  rowId: (row: T) => string
  columns?: Column<T>[]
  /** Feed mode. Receives whether the row is keyboard-focused. */
  renderRow?: (row: T, focused: boolean) => React.ReactNode
  href?: (row: T) => string
  views?: SavedView<T>[]
  /** Free-text haystack for one row. */
  searchable?: (row: T) => string
  bulkActions?: BulkAction[]
  csvRow?: (row: T) => Record<string, string | number>
  csvFilename?: string
  emptyTitle?: string
  emptyHint?: string
  searchPlaceholder?: string
  pageSize?: number
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
  toolbarRight?: React.ReactNode
}) {
  const router = useRouter()
  const list = useListState(defaultSort ? { sort: defaultSort.key, dir: defaultSort.dir } : undefined)
  const [selected, setSelected] = useState<string[]>([])
  const [focus, setFocus] = useState(0)
  const [pending, start] = useTransition()
  const rowRefs = useRef<(HTMLElement | null)[]>([])

  const view = views?.find((v) => v.id === list.view) ?? null

  // view → search → sort. Paging happens last so the count is honest.
  const filtered = useMemo(() => {
    const q = list.q.trim().toLowerCase()
    let out = rows
    if (view) out = out.filter(view.match)
    if (q && searchable) out = out.filter((r) => searchable(r).toLowerCase().includes(q))
    const col = columns?.find((c) => c.key === list.sort && c.value)
    if (col?.value) {
      const dir = list.dir === 'asc' ? 1 : -1
      out = [...out].sort((a, b) => {
        const av = col.value!(a)
        const bv = col.value!(b)
        // Nulls always sink, whichever way the column is pointing — an unknown
        // is not "smallest", it is "no answer", and it should never top the list.
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv)
        return dir * String(av).localeCompare(String(bv))
      })
    }
    return out
  }, [rows, view, list.q, list.sort, list.dir, columns, searchable])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(list.page, pageCount)
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Selecting a row and then filtering it away would silently act on records you
  // can no longer see, so selection is always intersected with what is on screen.
  const visibleIds = shown.map(rowId)
  const selectedHere = selected.filter((id) => visibleIds.includes(id))
  const allSelected = visibleIds.length > 0 && selectedHere.length === visibleIds.length

  useEffect(() => setFocus(0), [list.q, list.view, list.sort, list.dir, page])

  // Keyboard, matching the approval queue's existing J/K so the two agree.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (!shown.length) return
      const cur = shown[Math.min(focus, shown.length - 1)]
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setFocus((f) => Math.min(shown.length - 1, f + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocus((f) => Math.max(0, f - 1))
      } else if (e.key === 'x' && cur && bulkActions?.length) {
        e.preventDefault()
        toggle(rowId(cur))
      } else if (e.key === 'Enter' && cur && href) {
        e.preventDefault()
        router.push(href(cur))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown, focus, href, bulkActions]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    rowRefs.current[focus]?.scrollIntoView({ block: 'nearest' })
  }, [focus])

  function toggle(id: string) {
    setSelected((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))
  }

  function runBulk(action: BulkAction) {
    const ids = [...selectedHere]
    if (!ids.length) return
    if (action.confirm && !window.confirm(action.confirm(ids.length))) return
    start(async () => {
      const res = await action.run(ids)
      if (res.error) toast.error(res.error)
      else {
        toast.success(`${action.label} · ${ids.length} record${ids.length === 1 ? '' : 's'}`)
        setSelected([])
        router.refresh()
      }
    })
  }

  const body =
    shown.length === 0 ? (
      <EmptyState
        title={list.isFiltered ? 'Nothing matches that' : emptyTitle}
        hint={list.isFiltered ? 'Clear the filter to see everything again.' : emptyHint}
        filtered={list.isFiltered}
        action={
          list.isFiltered ? (
            <button
              type="button"
              onClick={list.clearAll}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              Clear filters
            </button>
          ) : undefined
        }
      />
    ) : renderRow ? (
      <div className="divide-y divide-border">
        {shown.map((row, i) => {
          const id = rowId(row)
          return (
            <div
              key={id}
              ref={(el) => {
                rowRefs.current[i] = el
              }}
              onClick={() => setFocus(i)}
              className={cn('transition-colors', i === focus && 'bg-muted/40')}
            >
              {renderRow(row, i === focus)}
            </div>
          )
        })}
      </div>
    ) : (
      <div className="relative w-full overflow-x-auto">
        <table className="w-full caption-bottom text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border">
              {bulkActions?.length ? (
                <th className="w-9 px-3 py-2">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selectedHere.length > 0 && !allSelected}
                    onCheckedChange={() =>
                      setSelected(allSelected ? [] : [...new Set([...selected, ...visibleIds])])
                    }
                    aria-label="Select all on this page"
                  />
                </th>
              ) : null}
              {(columns ?? []).map((c) => {
                const sorted = list.sort === c.key
                return (
                  <th
                    key={c.key}
                    className={cn(
                      'px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider whitespace-nowrap text-muted-foreground',
                      c.numeric && 'text-right',
                      c.hideBelow && HIDE_BELOW[c.hideBelow]
                    )}
                  >
                    {c.value ? (
                      <button
                        type="button"
                        onClick={() => list.setSort(c.key)}
                        className={cn(
                          'inline-flex items-center gap-1 uppercase transition-colors hover:text-foreground',
                          sorted && 'text-foreground'
                        )}
                      >
                        {c.header}
                        {sorted &&
                          (list.dir === 'asc' ? (
                            <ChevronUp className="size-3" />
                          ) : (
                            <ChevronDown className="size-3" />
                          ))}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((row, i) => {
              const id = rowId(row)
              const isSel = selected.includes(id)
              const link = href?.(row)
              return (
                <tr
                  key={id}
                  ref={(el) => {
                    rowRefs.current[i] = el
                  }}
                  // Start fetching the record the moment the pointer lands on
                  // its row. These pages are fully dynamic, so Next.js will not
                  // prefetch them on its own, and the click was paying for the
                  // whole round trip with nothing warmed up. Hover is typically
                  // a few hundred milliseconds ahead of the click — enough to
                  // have the shared layout and the route's data in flight.
                  onMouseEnter={() => link && router.prefetch(link)}
                  onFocus={() => link && router.prefetch(link)}
                  onClick={(e) => {
                    setFocus(i)
                    if (!link) return
                    // The whole row is the target, which is what every admin
                    // worth copying does — hitting a 12px name is not a hit
                    // area. Clicks that land on something interactive (the
                    // checkbox, a nested link, a button) belong to that thing.
                    const el = e.target as HTMLElement
                    if (el.closest('a,button,input,label,[role="checkbox"]')) return
                    // Cmd/Ctrl-click opens a new tab, same as a link would.
                    if (e.metaKey || e.ctrlKey) window.open(link, '_blank')
                    else router.push(link)
                  }}
                  data-state={isSel ? 'selected' : undefined}
                  className={cn(
                    'transition-colors hover:bg-muted/50 data-[state=selected]:bg-primary/10',
                    link && 'cursor-pointer',
                    i === focus && 'bg-muted/40'
                  )}
                >
                  {bulkActions?.length ? (
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={isSel}
                        onCheckedChange={() => toggle(id)}
                        aria-label="Select row"
                      />
                    </td>
                  ) : null}
                  {(columns ?? []).map((c, ci) => {
                    const content = c.cell(row)
                    return (
                      <td
                        key={c.key}
                        className={cn(
                          'px-3 py-2 align-middle',
                          c.numeric && 'text-right font-mono tabular-nums',
                          c.hideBelow && HIDE_BELOW[c.hideBelow],
                          c.className
                        )}
                      >
                        {/* Only the first cell carries the row link, so the whole
                            row is clickable without swallowing buttons in later
                            columns (the old advertiser table nested both). */}
                        {ci === 0 && link ? (
                          <Link href={link} className="block hover:underline">
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )

  return (
    <div className="space-y-2">
      <ListToolbar
        list={list}
        placeholder={searchPlaceholder}
        searchable={!!searchable}
        views={views?.map((v) => ({
          id: v.id,
          label: v.label,
          tone: v.tone,
          count: rows.filter(v.match).length,
        }))}
        sorts={(columns ?? [])
          .filter((c) => c.value)
          .map((c) => ({ key: c.key, label: c.header }))}
        selectedCount={selectedHere.length}
        bulkActions={bulkActions}
        onBulk={runBulk}
        onClearSelection={() => setSelected([])}
        bulkPending={pending}
        csv={
          csvRow && csvFilename
            ? { filename: csvFilename, rows: filtered.map(csvRow) }
            : undefined
        }
        right={toolbarRight}
      />

      <div className="overflow-hidden rounded-lg border border-border bg-card">{body}</div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of{' '}
            {filtered.length}
            {filtered.length !== rows.length && ` (filtered from ${rows.length})`}
          </span>
          {pageCount > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => list.setPage(page - 1)}
                className="rounded-md px-2 py-1 hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="tabular-nums">
                {page} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => list.setPage(page + 1)}
                className="rounded-md px-2 py-1 hover:bg-muted disabled:opacity-40"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
