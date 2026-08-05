'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Trash2, MapPin, Clock, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { StepHeader } from '@/components/app/StepHeader'
import { StickyCta } from '@/components/app/StickyCta'
import { RateLadder } from '@/components/app/RateLadder'
import { useBasePath } from '@/lib/useBasePath'
import { formatCents, ordinal } from '@/lib/format'
import { estMonthlyReachOf } from '@/lib/analytics'
import {
  quoteCart,
  nextRungUpsell,
  perLocationCents,
  TIER_LABEL,
  MIN_MONTHLY_CENTS,
  type QuoteOptions,
  type PricingConfig,
} from '@/lib/pricing'
import { CART_KEY } from '../browse/BrowseClient'
import { type CartVenue } from './types'

export function ReviewStep({
  venues,
  quoteOpts,
  pricingConfig,
}: {
  venues: CartVenue[]
  quoteOpts?: QuoteOptions
  pricingConfig?: PricingConfig
}) {
  const base = useBasePath()
  const byId = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues])
  const [cartIds, setCartIds] = useState<string[]>([])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CART_KEY)
      if (raw) setCartIds(JSON.parse(raw) as string[])
    } catch {}
  }, [])

  const cart = useMemo(
    () => cartIds.map((id) => byId.get(id)).filter(Boolean) as CartVenue[],
    [cartIds, byId]
  )
  const quote = useMemo(
    () => quoteCart(cart.map((v) => v.priceCents), quoteOpts, pricingConfig),
    [cart, quoteOpts, pricingConfig]
  )

  const totalCents = quote.totalCents

  // Estimated people your ad reaches each month across the picked screens — the
  // value side of the price. Clearly an estimate (from venue foot traffic), never
  // a measured count.
  const reachPerMonth = useMemo(() => estMonthlyReachOf(cart), [cart])

  // Last call on the volume ladder before they move on to creative + checkout.
  const upsell = useMemo(
    () => nextRungUpsell(cart.map((v) => v.priceCents), quoteOpts, pricingConfig),
    [cart, quoteOpts, pricingConfig]
  )

  function remove(id: string) {
    const next = cartIds.filter((x) => x !== id)
    setCartIds(next)
    try {
      sessionStorage.setItem(CART_KEY, JSON.stringify(next))
    } catch {}
  }

  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="font-heading text-xl font-bold">Your cart is empty</h1>
        <p className="text-sm text-muted-foreground">
          Head back to the map and tap the businesses you want to be in.
        </p>
        <Link href={`${base}/browse`} className={buttonVariants({ size: 'lg' })}>
          <MapPin className="size-4" /> Pick locations
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <StepHeader step={2} total={3} title="Review your locations" />

      <RateLadder count={cart.length} config={pricingConfig} />

      <div className="space-y-2.5">
        {cart.map((v) => (
          <Card key={v.id}>
            <CardContent className="p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{v.name}</div>
                  {v.openHours && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3 shrink-0" />
                      <span className="truncate">{v.openHours}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-heading font-bold tabular-nums">
                    {formatCents(v.priceCents)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(v.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${v.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-1.5 p-4 text-sm">
          <Row label="Subtotal" value={formatCents(quote.listCents)} />
          {quote.freeLocations > 0 && (
            <Row
              label={`Free locations (${quote.freeLocations})`}
              value={`-${formatCents(quote.listCents - quote.subtotalCents)}`}
              good
            />
          )}
          {quote.discountPct > 0 && (
            <Row
              label={`Discount (${Math.round(quote.discountPct * 100)}%${quote.hostPct > 0 ? ', incl. host' : ''})`}
              value={`-${formatCents(quote.subtotalCents - quote.discountedCents)}`}
              good
            />
          )}
          {quote.floorApplied && (
            <Row
              label="Account minimum"
              value={`$${((pricingConfig?.minMonthlyCents ?? MIN_MONTHLY_CENTS) / 100).toFixed(0)}`}
              muted
            />
          )}
          <div className="flex items-center justify-between border-t border-border pt-2 font-heading text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatCents(totalCents)}/mo</span>
          </div>
        </CardContent>
      </Card>

      {reachPerMonth > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10">
              <Users className="size-5 text-primary" />
            </span>
            <div className="min-w-0">
              <p className="font-heading text-lg font-bold tabular-nums">
                ~{reachPerMonth.toLocaleString()} people / month
              </p>
              <p className="text-xs text-muted-foreground">
                Estimated reach across your locations, from each venue&apos;s foot traffic. An
                estimate, not a measured count.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {upsell ? (
        <Link
          href={`${base}/browse`}
          className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10"
        >
          <span className="min-w-0 text-xs">
            <span className="block font-medium text-primary">
              {upsell.deltaCents <= 0
                ? `Your ${ordinal(upsell.rungLocations)} location is free`
                : `Add ${upsell.locationsNeeded} more locations and your ${ordinal(upsell.rungLocations)} is free`}
            </span>
            <span className="block text-muted-foreground">
              {upsell.deltaCents <= 0
                ? `Add ${upsell.locationsNeeded} more and you still pay ${formatCents(upsell.totalCents)} a month.`
                : `${formatCents(upsell.deltaCents)} more a month, and every location drops to ${formatCents(upsell.perLocationCents)}.`}
            </span>
          </span>
          <span className="shrink-0 text-xs font-medium text-primary">
            {upsell.deltaCents <= 0 ? 'Claim it' : 'Pick them'}
          </span>
        </Link>
      ) : (
        <Link
          href={`${base}/browse`}
          className="block text-center text-xs text-muted-foreground hover:text-foreground"
        >
          + Add more locations
        </Link>
      )}

      <StickyCta
        label="Add your ad"
        href={`${base}/new/creative`}
        // Last call, and it has to be in the bar that doesn't scroll — this is
        // the final screen before creative and checkout.
        note={
          upsell
            ? upsell.deltaCents <= 0
              ? `Add ${upsell.locationsNeeded} more and your ${ordinal(upsell.rungLocations)} location is FREE — still ${formatCents(upsell.totalCents)}/mo`
              : `Add ${upsell.locationsNeeded} more and every location drops to ${formatCents(upsell.perLocationCents)} — your ${ordinal(upsell.rungLocations)} is free`
            : undefined
        }
        priceTop={`${cart.length} location${cart.length === 1 ? '' : 's'} · ${formatCents(
          perLocationCents(cart.length, pricingConfig)
        )} each`}
        priceMain={`${formatCents(totalCents)}/mo`}
      />
    </div>
  )
}

function Row({
  label,
  value,
  good,
  muted,
}: {
  label: string
  value: string
  good?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? 'text-muted-foreground' : ''}>{label}</span>
      <span className={good ? 'tabular-nums text-emerald-500' : 'tabular-nums'}>{value}</span>
    </div>
  )
}
