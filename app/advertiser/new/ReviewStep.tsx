'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Trash2, MapPin, Clock, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { StepHeader } from '@/components/app/StepHeader'
import { StickyCta } from '@/components/app/StickyCta'
import { useBasePath } from '@/lib/useBasePath'
import { formatCents } from '@/lib/format'
import { estMonthlyReachOf } from '@/lib/analytics'
import {
  quoteCart,
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
          Head back to the map and tap the businesses you want a screen in.
        </p>
        <Link href={`${base}/browse`} className={buttonVariants({ size: 'lg' })}>
          <MapPin className="size-4" /> Pick screens
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <StepHeader step={2} total={3} title="Review your screens" />

      <div className="space-y-2.5">
        {cart.map((v) => (
          <Card key={v.id}>
            <CardContent className="p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{v.name}</div>
                  <div className="text-xs text-muted-foreground">{TIER_LABEL[v.tier]}</div>
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
          {quote.freeScreens > 0 && (
            <Row
              label={`Free screens (${quote.freeScreens})`}
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
                Estimated reach across your screens, from each venue&apos;s foot traffic. An
                estimate, not a measured count.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Link
        href={`${base}/browse`}
        className="block text-center text-xs text-muted-foreground hover:text-foreground"
      >
        + Add more screens
      </Link>

      <StickyCta
        label="Add your ad"
        href={`${base}/new/creative`}
        priceTop={`${cart.length} screen${cart.length === 1 ? '' : 's'}`}
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
