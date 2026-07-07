'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

// Reusable admin list search + optional status filter. Syncs `?q=` / `?status=`
// into the URL (debounced) so the server component re-queries — no client-side
// list duplication. Preserves any other params already on the URL (e.g. the
// territory the switcher set).
export function ListSearch({
  placeholder = 'Search…',
  statusOptions,
}: {
  placeholder?: string
  statusOptions?: { value: string; label: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')

  function push(next: URLSearchParams) {
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname)
  }

  // Debounced text sync so typing filters without a submit.
  useEffect(() => {
    const id = setTimeout(() => {
      const next = new URLSearchParams(Array.from(params.entries()))
      const v = q.trim()
      if (v) next.set('q', v)
      else next.delete('q')
      if ((params.get('q') ?? '') !== v) push(next)
    }, 250)
    return () => clearTimeout(id)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const status = params.get('status') ?? ''
  function setStatus(v: string) {
    const next = new URLSearchParams(Array.from(params.entries()))
    if (v) next.set('status', v)
    else next.delete('status')
    push(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="h-10 pl-9"
        />
      </div>
      {statusOptions && (
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-10 rounded-md border border-input bg-popover px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <option value="">All</option>
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
