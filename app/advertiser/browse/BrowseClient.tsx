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
import {
  quoteCart,
  volumeDiscount,
  type PriceTier,
  type QuoteOptions,
  type PricingConfig,
} from '@/lib/pricing'
import { useBasePath, homeFor } from '@/lib/useBasePath'
import { joinWaitlist, leaveWaitlist, requestCategory, rememberCategory } from './actions'

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
  comingSoon: boolean
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
  pricingConfig,
}: {
  venues: BrowseVenue[]
  categories: { id: string; name: string }[]
  activeCat: string | null
  categoryChosen: boolean
  quoteOpts?: QuoteOptions
  pricingConfig?: PricingConfig
}) {
  const router = useRouter()
  const base = useBasePath()
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
    () => quoteCart(cartVenues.map((v) => v.tier), quoteOpts, pricingConfig),
    [cartVenues, quoteOpts, pricingConfig]
  )

  const inCart = (id: string) => cart.includes(id)
  function toggle(id: string) {
    const v = byId.get(id)
    if (!v) return
    if (inCart(id)) setCart((c) => c.filter((x) => x !== id))
    else if (!v.categoryFull && v.open > 0 && !v.comingSoon) setCart((c) => [...c, id])
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
    const navigate = () => {
      const params = new URLSearchParams()
      if (c) params.set('cat', c)
      router.push(`${base}/browse?${params.toString()}`)
    }
    // Save a real category pick to the profile so we never ask again (next visit
    // + the creative step reuse it). Navigate only AFTER the save resolves —
    // fire-and-forget here was being cancelled by the navigation, so nothing
    // ever persisted. 'all'/clearing is left as-is.
    if (next.cat && next.cat !== 'all') {
      rememberCategory(next.cat)
        .then((res) => {
          if (res?.error) console.error('Could not save category:', res.error)
          navigate()
        })
        .catch((err) => {
          console.error('Could not save category:', err)
          navigate()
        })
    } else {
      navigate()
    }
  }

  // ---- Step 1: pick category ------------------------------------------------
  if (!categoryChosen) {
    return (
      <div className="space-y-5">
        {/* Not a numbered flow step — category is set once at signup. This only
            shows for accounts that don't have one yet, as a quick one-time gate. */}
        <StepHeader
          title="What do you sell?"
          subtitle="One quick thing — we lock in your category so competitors can't share your screens."
          backHref={homeFor(base)}
        />

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={catQuery}
            onChange={(e) => setCatQuery(e.target.value)}
            placeholder="Search your business type…"
            className="h-12 rounded-xl pl-10 text-base"
          />
        </div>

        {(() => {
          const q = catQuery.trim().toLowerCase()
          // Show the catalog as a filterable chip cloud so the screen reads as a
          // real picker, not an empty search box. Typing narrows it live.
          const matches = q
            ? categories.filter((c) => c.name.toLowerCase().includes(q))
            : categories
          const exact = categories.some((c) => c.name.toLowerCase() === q)
          return (
            <>
              {matches.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {matches.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => go({ cat: c.id })}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition hover:border-primary/60 hover:bg-primary/5 active:scale-[0.98]"
                    >
                      <Store className="size-4 shrink-0 text-primary" />
                      {c.name}
                    </button>
                  ))}
                </div>
              )}

              {/* No match in the catalog → request it (needs Loop Network approval). */}
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
                  Can&apos;t find it? Add &ldquo;{catQuery.trim()}&rdquo; for review
                </Button>
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
        step={1}
        total={3}
        title="Tap the businesses you want"
        subtitle="Tap any screen on the map or list to add it"
        backHref={`${base}/browse`}
      />

      {activeCatName ? (
        <p className="text-xs text-muted-foreground">
          You&apos;re advertising as a{' '}
          <span className="font-medium text-foreground">{activeCatName}</span>, so no other{' '}
          {activeCatName.toLowerCase()} can run on the screens you pick.{' '}
          <button
            onClick={() => router.push(`${base}/browse?pick=1`)}
            className="text-primary hover:underline"
          >
            Not a {activeCatName.toLowerCase()}? Change
          </button>
        </p>
      ) : (
        <button
          onClick={() => router.push(`${base}/browse?pick=1`)}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Pick your business type <ChevronRight className="size-3.5" />
        </button>
      )}

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
        href={`${base}/new`}
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
