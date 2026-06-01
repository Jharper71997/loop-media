'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { List, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber } from '@/lib/format'

export type BrowseVenue = {
  id: string
  name: string
  venue_type: string | null
  category: string | null
  foot_traffic_estimate: number
  lat: number | null
  lng: number | null
  screens: number
  capacity: number
  open: number
}

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => (
    <div className="grid h-[60vh] place-items-center rounded-lg border border-border text-muted-foreground">
      Loading map…
    </div>
  ),
})

function center(venues: BrowseVenue[]): [number, number] {
  const pts = venues.filter((v) => v.lat != null && v.lng != null)
  if (!pts.length) return [34.7541, -77.4302] // Jacksonville, NC
  const lat = pts.reduce((s, v) => s + (v.lat as number), 0) / pts.length
  const lng = pts.reduce((s, v) => s + (v.lng as number), 0) / pts.length
  return [lat, lng]
}

export function BrowseClient({
  venues,
  markets,
  activeMarket,
  categories,
  activeCat,
}: {
  venues: BrowseVenue[]
  markets: { id: string; name: string }[]
  activeMarket: string | null
  categories: { id: string; name: string }[]
  activeCat: string | null
}) {
  const router = useRouter()
  const [view, setView] = useState<'list' | 'map'>('list')

  // Preserve both filters when either changes. cat === null clears it.
  const go = (next: { market?: string; cat?: string | null }) => {
    const m = next.market ?? activeMarket ?? ''
    const c = next.cat === undefined ? activeCat : next.cat
    const params = new URLSearchParams()
    if (m) params.set('market', m)
    if (c) params.set('cat', c)
    router.push(`/advertiser/browse?${params.toString()}`)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Browse screens</h1>
          <p className="text-sm text-muted-foreground">
            {venues.length} screens{activeCat ? ' available to you' : ''} · sorted by foot traffic
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={activeMarket ?? ''} onValueChange={(v) => go({ market: v ?? '' })}>
            <SelectTrigger size="sm">
              <SelectValue>
                {(v: string | null) => markets.find((m) => m.id === v)?.name ?? 'Market'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {markets.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={activeCat ?? 'all'}
            onValueChange={(v) => go({ cat: v === 'all' ? null : v })}
          >
            <SelectTrigger size="sm">
              <SelectValue>
                {(v: string | null) =>
                  v && v !== 'all'
                    ? categories.find((c) => c.id === v)?.name ?? 'Category'
                    : 'Your category'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex rounded-md border border-border p-0.5">
            <Button
              variant={view === 'list' ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => setView('list')}
              aria-label="List view"
            >
              <List className="size-4" />
            </Button>
            <Button
              variant={view === 'map' ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => setView('map')}
              aria-label="Map view"
            >
              <MapPin className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {view === 'map' ? (
        <MapView venues={venues} center={center(venues)} />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venue</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Foot traffic / mo</TableHead>
                <TableHead className="text-right">Screens</TableHead>
                <TableHead>Availability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {venues.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No screens in this market yet.
                  </TableCell>
                </TableRow>
              )}
              {venues.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <div className="font-medium">{v.name}</div>
                    {v.venue_type && (
                      <div className="text-xs text-muted-foreground">{v.venue_type}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{v.category ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(v.foot_traffic_estimate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{v.screens}</TableCell>
                  <TableCell>
                    <Badge
                      variant={v.open > 0 ? 'default' : 'destructive'}
                      className={cn(v.open > 0 && 'bg-emerald-600')}
                    >
                      {v.open > 0 ? `${v.open} slots open` : 'Full'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex justify-center">
        <Link href="/advertiser/new" className={buttonVariants({ size: 'lg' })}>
          Launch a campaign across these screens
        </Link>
      </div>
    </div>
  )
}
