'use client'

import { cn } from '@/lib/utils'
import { formatCents, ordinal } from '@/lib/format'
import { RATE_CARD, perLocationCents, type PricingConfig } from '@/lib/pricing'

// The whole rate card, on screen while they shop.
//
// The volume discount used to be one tinted line above the venue list, which
// scrolled away the moment they started browsing — so nobody connected "tap
// another business" to "every business gets cheaper." This shows all three
// rungs at once with the one they're on lit up, so the incentive is visible
// before they've tapped anything and stays legible after.
//
// Built from RATE_CARD + the live config, never from hardcoded numbers, so it
// can't drift from what the cart charges.
export function RateLadder({
  count,
  config,
  className,
}: {
  count: number
  config?: PricingConfig
  className?: string
}) {
  // Turn the rungs into contiguous ranges: [1-2] [3-4] [5+].
  const starts = [1, ...[...RATE_CARD].map((r) => r.locations).sort((a, b) => a - b)]
  const rungs = starts.map((start, i) => {
    const next = starts[i + 1]
    return {
      start,
      label: next ? (next - 1 > start ? `${start}-${next - 1}` : `${start}`) : `${start}+`,
      eachCents: perLocationCents(start, config),
    }
  })

  // Which rung the cart is standing on (none until they've added something).
  const activeStart = count > 0 ? [...starts].reverse().find((s) => count >= s) : null

  // "Buy 4, the 5th is free" holds whenever the top rung drops the rate by
  // exactly enough that N-1 and N locations bill the same. Derived, so the claim
  // removes itself if the card ever stops making it true.
  const top = starts[starts.length - 1]
  const freeRung =
    (top - 1) * perLocationCents(top - 1, config) === top * perLocationCents(top, config)
      ? top
      : null

  return (
    <div className={cn('rounded-xl border border-border bg-card p-3', className)}>
      <div className="grid grid-cols-3 gap-2">
        {rungs.map((r) => {
          const on = r.start === activeStart
          return (
            <div
              key={r.start}
              className={cn(
                'rounded-lg px-2 py-2 text-center transition-colors',
                on ? 'bg-primary/15 ring-1 ring-primary/50' : 'bg-muted/40'
              )}
            >
              <div
                className={cn(
                  'text-[11px]',
                  on ? 'font-medium text-primary' : 'text-muted-foreground'
                )}
              >
                {r.label}
              </div>
              <div className="font-heading text-base font-bold tabular-nums">
                {formatCents(r.eachCents)}
                <span className="text-[10px] font-normal text-muted-foreground"> ea</span>
              </div>
            </div>
          )
        })}
      </div>

      {freeRung && (
        <p className="mt-2 text-center text-xs font-semibold text-primary">
          Buy {freeRung - 1} locations and the {ordinal(freeRung)} is free.
        </p>
      )}

      <p className="mt-1 text-center text-[11px] text-muted-foreground">
        {count > 0 && activeStart
          ? `You're at ${count} location${count === 1 ? '' : 's'}, ${formatCents(perLocationCents(count, config))} each. One price covers every TV in the business.`
          : 'One price per business, covering every TV inside it. The more you add, the less each one costs.'}
      </p>
    </div>
  )
}
