'use client'

import { useMemo, useState, useEffect, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { ChevronRight, Store, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StepHeader } from '@/components/app/StepHeader'
import { StickyCta } from '@/components/app/StickyCta'
import { VenueCard } from '@/components/app/VenueCard'
import { formatCents } from '@/lib/format'
import { quoteCart, volumeDiscount, type PriceTier, type QuoteOptions } from '@/lib/pricing'
import { joinWaitlist, leaveWaitlist, requestCategory } from './actions'

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
  ownCategory: boolean
  waitlisted: boolean
}

export const CART_KEY = 'loop.cart.venueIds'

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => (
    <div className="grid h-[40vh] place-items-center rounded-xl border border-border text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
})

export function BrowseClient({
  venues,
  categories,
  activeCat,
  categoryChosen,
  quoteOpts,
}: {
  venues: BrowseVenue[]
  categories: { id: string; name: string }[]
  activeCat: string | null
  categoryChosen: boolean
  quoteOpts?: QuoteOptions
}) {
  const router = useRouter()
  const [cart, setCart] = useState<string[]>([])
  const [waitlisted, setWaitlisted] = useState<Set<string>>(
    () => new Set(venues.filter((v) => v.waitlisted).map((v) => v.id))
  )
  const [catQuery, setCatQuery] = useState('')
  const [pending, start] = useTransition()

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
  const cartVenues = useMemo(
    () => cart.map((id) => byId.get(id)).filter(Boolean) as BrowseVenue[],
    [cart, byId]
  )
  const quote = useMemo(
    () => quoteCart(cartVenues.map((v) => v.tier), quoteOpts),
    [cartVenues, quoteOpts]
  )

  const inCart = (id: string) => cart.includes(id)
  function toggle(id: string) {
    const v = byId.get(id)
    if (!v) return
    if (inCart(id)) setCart((c) => c.filter((x) => x !== id))
    else if (!v.categoryFull && v.open > 0) setCart((c) => [...c, id])
  }

  function notify(v: BrowseVenue) {
    const on = waitlisted.has(v.id)
    setWaitlisted((s) => {
      const n = new Set(s)
      if (on) n.delete(v.id)
      else n.add(v.id)
      return n
    })
    start(async () => {
      const res = on ? await leaveWaitlist(v.id, activeCat) : await joinWaitlist(v.id, activeCat)
      if (res.error) {
        toast.error(res.error)
        setWaitlisted((s) => {
          const n = new Set(s)
          if (on) n.add(v.id)
          else n.delete(v.id)
          return n
        })
      } else {
        toast.success(on ? 'Removed from waitlist.' : `We'll alert you when ${v.name} opens up.`)
      }
    })
  }

  const go = (next: { cat?: string | null }) => {
    const c = next.cat === undefined ? activeCat : next.cat
    const params = new URLSearchParams()
    if (c) params.set('cat', c)
    router.push(`/advertiser/browse?${params.toString()}`)
  }

  // ---- Step 1: pick category ------------------------------------------------
  if (!categoryChosen) {
    return (
      <div className="space-y-5">
        <StepHeader
          step={1}
          total={4}
          title="What do you sell?"
          subtitle="We lock in your category so competitors can't share your screens."
          backHref="/advertiser"
        />

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={catQuery}
            onChange={(e) => setCatQuery(e.target.value)}
            placeholder="Search your business type…"
            className="pl-9"
          />
        </div>

        {(() => {
          const q = catQuery.trim().toLowerCase()
          const matches = q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories
          const exact = categories.some((c) => c.name.toLowerCase() === q)
          return (
            <>
              {matches.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {matches.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => go({ cat: c.id })}
                      className="flex min-h-20 flex-col items-start justify-between rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/50 active:scale-[0.99]"
                    >
                      <Store className="size-5 text-primary" />
                      <span className="font-medium leading-tight">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Not in the catalog → request it (needs Loop Network approval). */}
              {q && !exact && (
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await requestCategory(catQuery)
                      if (res.error) {
                        toast.error(res.error)
                        return
                      }
                      toast.success(
                        `Thanks — we'll review "${catQuery.trim()}" and add it. Browsing all screens for now.`
                      )
                      go({ cat: 'all' })
                    })
                  }
                >
                  Other: add &ldquo;{catQuery.trim()}&rdquo; (needs our approval)
                </Button>
              )}

              {matches.length === 0 && !q && (
                <p className="text-sm text-muted-foreground">No categories yet.</p>
              )}
            </>
          )
        })()}

        <Button variant="ghost" size="lg" className="w-full" onClick={() => go({ cat: 'all' })}>
          Not sure yet — show me everything
        </Button>
      </div>
    )
  }

  // ---- Step 2: tap businesses on the map ------------------------------------
  const activeCatName = activeCat ? categories.find((c) => c.id === activeCat)?.name : null
  const nextTierAt = [5, 10, 15, 25].find((n) => cartVenues.length < n)
  const nextPct = nextTierAt ? volumeDiscount(nextTierAt) : null

  return (
    <div className="space-y-4">
      <StepHeader
        step={2}
        total={4}
        title="Tap the businesses you want"
        subtitle={activeCatName ? `Exclusive for ${activeCatName}` : 'All categories'}
        backHref="/advertiser/browse"
      />

      <button
        onClick={() => go({ cat: null })}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        Change category <ChevronRight className="size-3.5" />
      </button>

      {venues.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          No screens available yet. Check back soon.
        </p>
      ) : (
        <>
          <MapView
            venues={venues}
            cart={cart}
            waitlisted={waitlisted}
            onToggle={toggle}
            onNotify={notify}
          />

          {nextPct != null && cartVenues.length > 0 && (
            <p className="rounded-lg bg-primary/10 px-3 py-2 text-center text-xs text-primary">
              Add {nextTierAt! - cartVenues.length} more screen
              {nextTierAt! - cartVenues.length === 1 ? '' : 's'} to unlock{' '}
              {Math.round(nextPct * 100)}% off
            </p>
          )}

          <div className="space-y-2.5">
            {venues.map((v) => (
              <VenueCard
                key={v.id}
                venue={v}
                inCart={inCart(v.id)}
                waitlisted={waitlisted.has(v.id)}
                pending={pending}
                onToggle={() => toggle(v.id)}
                onNotify={() => notify(v)}
              />
            ))}
          </div>
        </>
      )}

      <StickyCta
        label={cartVenues.length ? 'Review' : 'Tap a screen to start'}
        disabled={cartVenues.length === 0}
        href="/advertiser/new"
        priceTop={
          cartVenues.length
            ? `${cartVenues.length} screen${cartVenues.length === 1 ? '' : 's'}${
                quote.discountPct > 0 ? ` · ${Math.round(quote.discountPct * 100)}% off` : ''
              }`
            : undefined
        }
        priceMain={cartVenues.length ? `${formatCents(quote.totalCents)}/mo` : undefined}
      />
    </div>
  )
}
