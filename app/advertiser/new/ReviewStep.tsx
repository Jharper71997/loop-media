'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Trash2, MapPin } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { StepHeader } from '@/components/app/StepHeader'
import { StickyCta } from '@/components/app/StickyCta'
import { useBasePath } from '@/lib/useBasePath'
import { formatCents } from '@/lib/format'
import {
  quoteCart,
  TIER_LABEL,
  MIN_MONTHLY_CENTS,
  type QuoteOptions,
  type PricingConfig,
} from '@/lib/pricing'
import { CART_KEY } from '../browse/BrowseClient'
import type { CartVenue } from './types'

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
            <CardContent className="flex items-center justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <div className="truncate font-medium">{v.name}</div>
                <div className="text-xs text-muted-foreground">{TIER_LABEL[v.tier]}</div>
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
            <span className="tabular-nums">{formatCents(quote.totalCents)}/mo</span>
          </div>
        </CardContent>
      </Card>

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
        priceMain={`${formatCents(quote.totalCents)}/mo`}
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
