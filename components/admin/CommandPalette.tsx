'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, CornerDownLeft } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { adminSearch, type AdminSearchHit } from '@/app/(admin)/admin/search-actions'
import { trackSearch, trackNavClick } from '@/lib/gtag'

// ⌘K / Ctrl+K palette to jump to any venue, advertiser, or screen by name —
// navigate-then-scroll doesn't scale once there are hundreds of venues.
export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<AdminSearchHit[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const reqId = useRef(0)

  // Global ⌘K / Ctrl+K toggle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Reset when closed.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits([])
      setActive(0)
    }
  }, [open])

  // Debounced search.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    const my = ++reqId.current
    const id = setTimeout(async () => {
      const res = await adminSearch(q)
      if (my !== reqId.current) return // a newer query superseded this one
      setHits(res)
      setActive(0)
      setLoading(false)
      trackSearch({ searchTerm: q, context: 'command_palette' })
    }, 200)
    return () => clearTimeout(id)
  }, [query])

  function go(hit: AdminSearchHit) {
    trackNavClick({ linkText: hit.label, linkUrl: hit.href, navRegion: 'command_palette_result' })
    setOpen(false)
    router.push(hit.href)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(hits.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault()
      go(hits[active])
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search venues, advertisers, screens…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {query.trim().length < 2 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search.
            </p>
          ) : loading && hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</p>
          ) : (
            hits.map((hit, i) => (
              <button
                key={`${hit.type}-${hit.id}`}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(hit)}
                className={
                  'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition ' +
                  (i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')
                }
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{hit.label}</span>
                  {hit.sub && <span className="block truncate text-xs text-muted-foreground">{hit.sub}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {hit.type}
                  </span>
                  {i === active && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
