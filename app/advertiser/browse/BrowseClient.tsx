'use client'

import { useMemo, useState, useEffect, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { List, MapPin, Plus, Check, Bell, BellRing, ShoppingCart, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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
import { formatNumber, formatCents } from '@/lib/format'
import {
  quoteCart,
  volumeDiscount,
  TIER_LABEL,
  MIN_MONTHLY_CENTS,
  type PriceTier,
  type QuoteOptions,
} from '@/lib/pricing'
import { joinWaitlist, leaveWaitlist } from './actions'

export type BrowseVenue = {
  id: string
  name: string
  venue_type: string | null
  category: string | null
  foot_traffic_estimate: number
  lat: number | null
  lng: number | null
  tier: PriceTier
  priceCents: number
  screens: number
  capacity: number
  open: number
  categoryFull: boolean
  waitlisted: boolean
}

export const CART_KEY = 'loop.cart.venueIds'

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
  quoteOpts,
}: {
  venues: BrowseVenue[]
  markets: { id: string; name: string }[]
  activeMarket: string | null
  categories: { id: string; name: string }[]
  activeCat: string | null
  quoteOpts?: QuoteOptions
}) {
  const router = useRouter()
  const [view, setView] = useState<'list' | 'map'>('map')
  const [cart, setCart] = useState<string[]>([])
  const [waitlisted, setWaitlisted] = useState<Set<string>>(
    () => new Set(venues.filter((v) => v.waitlisted).map((v) => v.id))
  )
  const [pending, start] = useTransition()

  // Persist the cart so checkout (/advertiser/new) inherits the picked screens.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CART_KEY)
      if (raw) setCart(JSON.parse(raw) as string[])
    } catch {}
  }, [])
  useEffect(() => {
    try {
      sessionStorage.setItem(CART_KEY, JSON.stringify(cart))
    } catch {}
  }, [cart])

  const byId = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues])
  // Keep only cart entries that exist in the current market view for pricing.
  const cartVenues = useMemo(
    () => cart.map((id) => byId.get(id)).filter(Boolean) as BrowseVenue[],
    [cart, byId]
  )
  const quote = useMemo(
    () => quoteCart(cartVenues.map((v) => v.tier), quoteOpts),
    [cartVenues, quoteOpts]
  )

  const inCart = (id: string) => cart.includes(id)
  const addable = (v: BrowseVenue) => !v.categoryFull && v.open > 0
  function toggle(id: string) {
    const v = byId.get(id)
    if (!v) return
    if (inCart(id)) {
      setCart((c) => c.filter((x) => x !== id))
    } else if (addable(v)) {
      setCart((c) => [...c, id])
    }
  }

  function notify(v: BrowseVenue) {
    const on = waitlisted.has(v.id)
    setWaitlisted((s) => {
      const n = new Set(s)
      if (on) n.delete(v.id)
      else n.add(v.id)
      return n
    }) // optimistic
    start(async () => {
      const res = on ? await leaveWaitlist(v.id, activeCat) : await joinWaitlist(v.id, activeCat)
      if (res.error) {
        toast.error(res.error)
        setWaitlisted((s) => {
          const n = new Set(s)
          if (on) n.add(v.id)
          else n.delete(v.id)
          return n
        }) // rollback
      } else {
        toast.success(on ? 'Removed from waitlist.' : `We'll alert you when ${v.name} opens up.`)
      }
    })
  }

  function checkout() {
    if (!cart.length) return toast.error('Tap a few screens to build your cart first.')
    try {
      sessionStorage.setItem(CART_KEY, JSON.stringify(cart))
    } catch {}
    router.push('/advertiser/new')
  }

  // Preserve both filters when either changes. cat === null clears it.
  const go = (next: { market?: string; cat?: string | null }) => {
    const m = next.market ?? activeMarket ?? ''
    const c = next.cat === undefined ? activeCat : next.cat
    const params = new URLSearchParams()
    if (m) params.set('market', m)
    if (c) params.set('cat', c)
    router.push(`/advertiser/browse?${params.toString()}`)
  }

  const nextTierAt = [5, 10, 15, 25].find((n) => cartVenues.length < n)
  const nextPct = nextTierAt ? volumeDiscount(nextTierAt) : null

  return (
    <div className="space-y-5 pb-40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Build your campaign</h1>
          <p className="text-sm text-muted-foreground">
            Tap the businesses you want a screen in. Each one adds a monthly placement to your cart.
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
              <SelectItem value="all">Your category</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex rounded-md border border-border p-0.5">
            <Button
              variant={view === 'map' ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => setView('map')}
              aria-label="Map view"
            >
              <MapPin className="size-4" />
            </Button>
            <Button
              variant={view === 'list' ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => setView('list')}
              aria-label="List view"
            >
              <List className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {!activeCat && (
        <p className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Pick <span className="font-medium text-foreground">your category</span> above to lock in
          exclusivity — we&apos;ll gray out any business already taken by a competitor.
        </p>
      )}

      {view === 'map' ? (
        <MapView
          venues={venues}
          center={center(venues)}
          cart={cart}
          waitlisted={waitlisted}
          onToggle={toggle}
          onNotify={notify}
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Venue</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Foot traffic / mo</TableHead>
                <TableHead className="text-right">Price / mo</TableHead>
                <TableHead className="text-right">Action</TableHead>
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
              {venues.map((v) => {
                const on = inCart(v.id)
                const wl = waitlisted.has(v.id)
                return (
                  <TableRow key={v.id} className={cn(v.categoryFull && 'opacity-60')}>
                    <TableCell>
                      <div className="font-medium">{v.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {TIER_LABEL[v.tier]} · {v.screens} screen{v.screens === 1 ? '' : 's'}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{v.category ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(v.foot_traffic_estimate)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCents(v.priceCents)}
                    </TableCell>
                    <TableCell className="text-right">
                      {v.categoryFull ? (
                        <Button
                          variant={wl ? 'secondary' : 'outline'}
                          size="sm"
                          disabled={pending}
                          onClick={() => notify(v)}
                        >
                          {wl ? (
                            <>
                              <BellRing className="size-4" /> Waitlisted
                            </>
                          ) : (
                            <>
                              <Bell className="size-4" /> Notify me
                            </>
                          )}
                        </Button>
                      ) : v.open === 0 ? (
                        <Badge variant="destructive">Full</Badge>
                      ) : (
                        <Button
                          variant={on ? 'secondary' : 'default'}
                          size="sm"
                          onClick={() => toggle(v.id)}
                        >
                          {on ? (
                            <>
                              <Check className="size-4" /> Added
                            </>
                          ) : (
                            <>
                              <Plus className="size-4" /> Add
                            </>
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Sticky cart bar */}
      <div className="fixed inset-x-0 bottom-0 z-[1000] border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <ShoppingCart className="size-5 text-muted-foreground" />
              <span className="text-sm font-medium">
                {cartVenues.length} screen{cartVenues.length === 1 ? '' : 's'}
              </span>
            </div>
            {quote.discountPct > 0 && (
              <Badge className="bg-emerald-600">
                {Math.round(quote.discountPct * 100)}% off
                {quote.hostPct > 0 ? ' (incl. host)' : ''}
              </Badge>
            )}
            {nextPct != null && cartVenues.length > 0 && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Add {nextTierAt! - cartVenues.length} more → {Math.round(nextPct * 100)}% off
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              {quote.floorApplied && (
                <div className="text-[11px] text-muted-foreground">
                  ${(MIN_MONTHLY_CENTS / 100).toFixed(0)}/mo account minimum
                </div>
              )}
              <div className="text-xl font-semibold tabular-nums">
                {formatCents(quote.totalCents)}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </div>
            </div>
            {cart.length > 0 && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCart([])}
                aria-label="Clear cart"
              >
                <X className="size-4" />
              </Button>
            )}
            <Button size="lg" onClick={checkout} disabled={cartVenues.length === 0}>
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
