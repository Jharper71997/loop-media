'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { trackFilter, trackSearch } from '@/lib/gtag'

// One place that owns what a list is currently showing, and it owns it IN THE URL.
//
// Before this, the two halves of "list state" lived in two components that could
// not talk to each other: ListSearch synced `?q=`/`?status=` to the URL but had
// no sort, and ListControls had search + sort + filter chips but kept all of it
// in React state — so the home board's entire filter was lost on reload, could
// not be shared, and the back button did nothing.
//
// Everything here goes in the query string, which buys three things for free:
// a filtered list is a link you can send yourself, the back button steps through
// what you were looking at, and the server component can do the filtering rather
// than shipping every row to the client to hide most of them.
//
// The text box is debounced (typing should filter without a submit) while
// everything else applies immediately — a click has already expressed intent.

export const LIST_DEBOUNCE_MS = 250

export type ListState = {
  q: string
  /** Column key currently sorted, or '' for the list's default order. */
  sort: string
  dir: 'asc' | 'desc'
  /** Saved view id, e.g. 'all' | 'paying' | 'comped'. */
  view: string
  page: number
  /** Any extra facet, e.g. { status: 'active' }. */
  facets: Record<string, string>
}

export function useListState(defaults?: Partial<ListState>) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // Label analytics by the listing being filtered ('advertisers', 'venues', …).
  const context = pathname.split('/').filter(Boolean).pop() ?? 'list'

  const state: ListState = useMemo(() => {
    const facets: Record<string, string> = {}
    for (const [k, v] of params.entries()) {
      if (['q', 'sort', 'dir', 'view', 'page'].includes(k)) continue
      facets[k] = v
    }
    return {
      q: params.get('q') ?? '',
      sort: params.get('sort') ?? defaults?.sort ?? '',
      dir: (params.get('dir') as 'asc' | 'desc') ?? defaults?.dir ?? 'desc',
      view: params.get('view') ?? defaults?.view ?? 'all',
      page: Math.max(1, Number(params.get('page') ?? 1) || 1),
      facets,
    }
  }, [params, defaults?.sort, defaults?.dir, defaults?.view])

  // Local mirror so typing stays responsive while the URL catches up.
  const [draftQ, setDraftQ] = useState(state.q)
  useEffect(() => setDraftQ(state.q), [state.q])

  const write = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(Array.from(params.entries()))
      mutate(next)
      // Any change to what is being shown invalidates which page you were on.
      next.delete('page')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router]
  )

  useEffect(() => {
    const id = setTimeout(() => {
      const v = draftQ.trim()
      if ((params.get('q') ?? '') === v) return
      trackSearch({ searchTerm: v, context })
      write((next) => (v ? next.set('q', v) : next.delete('q')))
    }, LIST_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [draftQ]) // eslint-disable-line react-hooks/exhaustive-deps

  const setSort = useCallback(
    (key: string) => {
      // Clicking the sorted column flips direction; a new column starts descending,
      // because on this admin every sortable column is a "biggest/worst first" one.
      const flip = state.sort === key && state.dir === 'desc' ? 'asc' : 'desc'
      trackFilter({ filterType: 'sort', filterValue: `${key}:${flip}`, context })
      write((next) => {
        next.set('sort', key)
        next.set('dir', flip)
      })
    },
    [state.sort, state.dir, write, context]
  )

  const setView = useCallback(
    (view: string) => {
      trackFilter({ filterType: 'view', filterValue: view, context })
      write((next) => {
        if (view && view !== 'all') next.set('view', view)
        else next.delete('view')
        // A saved view carries its own filters; leaving stale facets on would
        // silently intersect them and show a list nobody asked for.
        for (const k of Object.keys(state.facets)) next.delete(k)
      })
    },
    [write, context, state.facets]
  )

  const setFacet = useCallback(
    (key: string, value: string | null) => {
      trackFilter({ filterType: key, filterValue: value ?? 'all', context })
      write((next) => (value ? next.set(key, value) : next.delete(key)))
    },
    [write, context]
  )

  const setPage = useCallback(
    (page: number) => {
      const next = new URLSearchParams(Array.from(params.entries()))
      if (page > 1) next.set('page', String(page))
      else next.delete('page')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router]
  )

  const clearAll = useCallback(() => {
    trackFilter({ filterType: 'clear', filterValue: 'all', context })
    setDraftQ('')
    router.replace(pathname, { scroll: false })
  }, [pathname, router, context])

  /** True when anything beyond the default view is narrowing the list. */
  const isFiltered = !!state.q || Object.keys(state.facets).length > 0 || state.view !== 'all'

  return {
    ...state,
    draftQ,
    setQ: setDraftQ,
    setSort,
    setView,
    setFacet,
    setPage,
    clearAll,
    isFiltered,
  }
}
