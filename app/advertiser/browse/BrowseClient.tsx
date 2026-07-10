'use client'

import { useCallback, useMemo, useState, useEffect, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { ChevronRight, Store, Search, Navigation, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StepHeader } from '@/components/app/StepHeader'
import { StickyCta } from '@/components/app/StickyCta'
import { VenueCard } from '@/components/app/VenueCard'
import { distanceMiles, NEARBY_RADIUS_MI } from '@/lib/geo'
import { formatCents } from '@/lib/format'
import {
  quoteCart,
  volumeDiscount,
  MIN_MONTHLY_CENTS,
  type PriceTier,
  type QuoteOptions,
  type PricingConfig,
} from '@/lib/pricing'
import { useBasePath, homeFor } from '@/lib/useBasePath'
import { trackSearch, trackFilter } from '@/lib/gtag'
import { joinWaitlist, leaveWaitlist, requestCategory, rememberCategory } from './actions'

export type BrowseVenue = {
  id: string
  name: string
  logoUrl: string | null
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
  // Human "Mon–Fri, 10 AM–10 PM" line so advertisers see when the venue is open
  // (and thus when their ad actually plays) before buying. Null if unknown.
  openHours: string | null
  comingSoon: boolean
  categoryFull: boolean
  ownCategory: boolean
  waitlisted: boolean
  // Filled in client-side once we know the advertiser's location; drives the
  // "X mi away" hint and nearest-first ordering on the browse map.
  distanceMi?: number | null
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

  // Advertiser location (browser geolocation). We center the map on them and
  // show only the screens near them, so they don't scroll a nationwide map to
  // find their own town. Nothing is stored — it's re-asked each visit.
  const [geoStatus, setGeoStatus] = useState<
    'idle' | 'locating' | 'ready' | 'denied' | 'unsupported'
  >('idle')
  const [userLoc, setUserLoc] = useState<[number, number] | null>(null)
  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('unsupported')
      return
    }
    setGeoStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc([pos.coords.latitude, pos.coords.longitude])
        setGeoStatus('ready')
      },
      () => setGeoStatus('denied'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
    )
  }, [])
  // NOTE: we intentionally do NOT auto-locate on mount — firing the OS permission
  // dialog before the advertiser has seen a single screen reads as hostile. They
  // tap "Use my location" (below) when they want nearest-first.

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

  // Debounced analytics for the business-type search box (does not touch the
  // live, synchronous filtering below — purely a settled-query signal).
  useEffect(() => {
    const t = catQuery.trim()
    if (!t) return
    const id = setTimeout(
      () => trackSearch({ searchTerm: t, context: 'advertiser_browse_category' }),
      400
    )
    return () => clearTimeout(id)
  }, [catQuery])

  const byId = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues])
  const cartVenues = useMemo(
    () => cart.map((id) => byId.get(id)).filter(Boolean) as BrowseVenue[],
    [cart, byId]
  )
  const quote = useMemo(
    () => quoteCart(cartVenues.map((v) => v.priceCents), quoteOpts, pricingConfig),
    [cartVenues, quoteOpts, pricingConfig]
  )

  const inCart = (id: string) => cart.includes(id)
  function toggle(id: string) {
    const v = byId.get(id)
    if (!v) return
    if (inCart(id)) setCart((c) => c.filter((x) => x !== id))
    // Offline ("coming soon") screens are still buyable — the ad just starts running
    // once the screen is back online. Only own-category and full screens are blocked.
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
    if (next.cat !== undefined) {
      trackFilter({
        filterType: 'category',
        filterValue: categories.find((c) => c.id === next.cat)?.name ?? next.cat ?? 'all',
        context: 'advertiser_browse',
      })
    }
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
          subtitle="One quick thing — tell us your line of business so we place your ads on the right screens."
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
          // Search-first: the full catalog is ~160 categories, so a chip wall reads
          // as overwhelming. Show nothing until they type, then narrow live.
          const matches = q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : []
          const exact = categories.some((c) => c.name.toLowerCase() === q)
          return (
            <>
              {!q && (
                <p className="text-sm text-muted-foreground">
                  Start typing to find your line of business — bar, gym, salon, auto repair,
                  restaurant…
                </p>
              )}
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

  // Rank every mappable venue by distance from the advertiser, then keep the ones
  // within the radius (closest first). Until we know where they are (locating /
  // denied / unsupported) we fall back to the full list so the page still works.
  const knowsLoc = geoStatus === 'ready' && userLoc != null
  const ranked = knowsLoc
    ? venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => ({
          ...v,
          distanceMi: distanceMiles(userLoc as [number, number], [v.lat as number, v.lng as number]),
        }))
        .sort((a, b) => a.distanceMi - b.distanceMi)
    : null
  const within = ranked ? ranked.filter((v) => v.distanceMi <= NEARBY_RADIUS_MI) : null
  // Show every active screen (nearest-first once we know where they are). We used
  // to hide anything past the radius, but the map should default to their area and
  // still let them zoom out to the whole network — so the radius now only frames
  // the initial view (frameBounds below); it no longer filters out screens.
  const displayVenues: BrowseVenue[] = ranked ?? venues
  // A ~25mi box around the advertiser to frame the map on entry. Δlat ≈ 1/69 deg
  // per mile; Δlng widens with latitude. Null until we know their location, in
  // which case MapView falls back to framing all venues.
  const frameBounds: [[number, number], [number, number]] | null =
    knowsLoc && userLoc
      ? (() => {
          const dLat = NEARBY_RADIUS_MI / 69
          const dLng = dLat / Math.cos((userLoc[0] * Math.PI) / 180)
          return [
            [userLoc[0] - dLat, userLoc[1] - dLng],
            [userLoc[0] + dLat, userLoc[1] + dLng],
          ]
        })()
      : null

  return (
    <div className="space-y-4">
      <StepHeader
        step={1}
        total={3}
        title="Tap the businesses you want"
        subtitle={
          knowsLoc ? 'Screens near you — tap any to add' : 'Tap any screen on the map or list to add it'
        }
        backHref={homeFor(base)}
      />

      {activeCatName ? (
        <p className="text-xs text-muted-foreground">
          You&apos;re advertising in{' '}
          <span className="font-medium text-foreground">{activeCatName}</span>, so we keep your ad
          off screens that already run a competing {activeCatName} business.{' '}
          <button
            onClick={() => router.push(`${base}/browse?pick=1`)}
            className="text-primary hover:underline"
          >
            Wrong category? Change
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

      {/* Location status. When we know where they are, the map is centered on
          them and the list is scoped to nearby screens. */}
      {geoStatus === 'locating' && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Finding screens near you…
        </p>
      )}
      {(geoStatus === 'idle' || geoStatus === 'denied' || geoStatus === 'unsupported') && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {geoStatus === 'idle'
              ? 'See the screens closest to you first, or browse the whole map below.'
              : 'Turn on location to see the screens closest to you. Showing everything for now.'}
          </p>
          <Button size="sm" variant="outline" className="shrink-0" onClick={locate}>
            <Navigation className="size-4" /> Use my location
          </Button>
        </div>
      )}
      {knowsLoc && (
        <p className="text-xs text-muted-foreground">
          {within && within.length > 0
            ? `${within.length} screen${within.length === 1 ? '' : 's'} within ${NEARBY_RADIUS_MI} miles, closest first. Zoom out to see the whole network.`
            : `No screens within ${NEARBY_RADIUS_MI} miles yet — showing the closest first. Zoom out to see all.`}
        </p>
      )}

      {venues.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          No screens available yet. Check back soon.
        </p>
      ) : (
        // Desktop: map on the left (sticky + tall) with the list beside it, so the
        // page fills the screen. Mobile: the two just stack.
        <div className="lg:grid lg:grid-cols-5 lg:items-start lg:gap-6">
          <div className="lg:col-span-3 lg:sticky lg:top-20">
            <MapView
              venues={displayVenues}
              cart={cart}
              waitlisted={waitlisted}
              onToggle={toggle}
              onNotify={notify}
              userLoc={knowsLoc ? userLoc : null}
              frameBounds={frameBounds}
            />
          </div>

          <div className="mt-4 space-y-2.5 lg:col-span-2 lg:mt-0">
            {nextPct != null && cartVenues.length > 0 && (
              <p className="rounded-lg bg-primary/10 px-3 py-2 text-center text-xs text-primary">
                Add {nextTierAt! - cartVenues.length} more screen
                {nextTierAt! - cartVenues.length === 1 ? '' : 's'} to unlock{' '}
                {Math.round(nextPct * 100)}% off
              </p>
            )}

            {/* The sticky total floors up to the account minimum; without a note
                that number reads as a bug when the cart is small. */}
            {quote.floorApplied && cartVenues.length > 0 && (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground">
                {formatCents(pricingConfig?.minMonthlyCents ?? MIN_MONTHLY_CENTS)}/mo account
                minimum — add more screens to use it all.
              </p>
            )}

            {displayVenues.map((v) => (
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
        </div>
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
