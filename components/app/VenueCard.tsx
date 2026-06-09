'use client'

import { Plus, Check, Bell, BellRing } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCents } from '@/lib/format'
import { TIER_LABEL, type PriceTier } from '@/lib/pricing'

export type VenueCardData = {
  id: string
  name: string
  tier: PriceTier
  priceCents: number
  foot_traffic_estimate: number
  categoryFull: boolean
  open: number
}

// One tappable business in the build flow. Tapping the card adds/removes when
// available; full-by-category venues offer a notify-me waitlist instead.
export function VenueCard({
  venue,
  inCart,
  waitlisted,
  pending,
  onToggle,
  onNotify,
}: {
  venue: VenueCardData
  inCart: boolean
  waitlisted: boolean
  pending?: boolean
  onToggle: () => void
  onNotify: () => void
}) {
  const addable = !venue.categoryFull && venue.open > 0
  return (
    <div
      role={addable ? 'button' : undefined}
      tabIndex={addable ? 0 : undefined}
      onClick={addable ? onToggle : undefined}
      onKeyDown={addable ? (e) => (e.key === 'Enter' || e.key === ' ') && onToggle() : undefined}
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border p-3.5 transition',
        venue.categoryFull && 'opacity-60',
        inCart ? 'border-primary bg-primary/10' : 'border-border bg-card',
        addable && 'cursor-pointer active:scale-[0.99]'
      )}
    >
      <div className="min-w-0">
        <div className="truncate font-medium">{venue.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {TIER_LABEL[venue.tier]}
        </div>
        <div className="mt-1 font-heading text-lg font-bold tabular-nums">
          {formatCents(venue.priceCents)}
          <span className="text-xs font-normal text-muted-foreground">/mo</span>
        </div>
      </div>

      <div className="shrink-0">
        {venue.categoryFull ? (
          <Button
            variant={waitlisted ? 'secondary' : 'outline'}
            size="sm"
            disabled={pending}
            onClick={(e) => {
              e.stopPropagation()
              onNotify()
            }}
          >
            {waitlisted ? (
              <>
                <BellRing className="size-4" /> Waitlisted
              </>
            ) : (
              <>
                <Bell className="size-4" /> Notify me
              </>
            )}
          </Button>
        ) : venue.open === 0 ? (
          <Badge variant="destructive">Full</Badge>
        ) : (
          <span
            className={cn(
              'grid size-9 place-items-center rounded-full',
              inCart ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground'
            )}
          >
            {inCart ? <Check className="size-5" /> : <Plus className="size-5" />}
          </span>
        )}
      </div>
    </div>
  )
}
