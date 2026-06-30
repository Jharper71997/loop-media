'use client'

import { Plus, Check, Bell, BellRing } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCents, formatNumber } from '@/lib/format'
import { TIER_LABEL, type PriceTier } from '@/lib/pricing'

export type VenueCardData = {
  id: string
  name: string
  venue_type: string | null
  category: string | null
  tier: PriceTier
  priceCents: number
  foot_traffic_estimate: number
  screens: number
  categoryFull: boolean
  ownCategory: boolean
  open: number
  comingSoon: boolean
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
  const addable = !venue.categoryFull && venue.open > 0 && !venue.comingSoon
  // What this place actually is, so advertisers know where their ad runs.
  const businessType = venue.category ?? venue.venue_type ?? TIER_LABEL[venue.tier]
  const info = [
    businessType,
    venue.foot_traffic_estimate > 0
      ? `~${formatNumber(venue.foot_traffic_estimate)} visitors/mo`
      : null,
    `${venue.screens} screen${venue.screens === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ')
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
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{info}</div>
        {venue.comingSoon && (
          <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Coming soon · screen not live yet
          </span>
        )}
        <div className="mt-1 font-heading text-lg font-bold tabular-nums">
          {formatCents(venue.priceCents)}
          <span className="text-xs font-normal text-muted-foreground">/mo</span>
        </div>
      </div>

      <div className="shrink-0">
        {venue.ownCategory ? (
          // Same line of business as the venue — competitors are never allowed,
          // so there's nothing to wait for.
          <Badge variant="secondary" title="A venue won't run ads from its own line of business.">
            Same business
          </Badge>
        ) : venue.comingSoon ? (
          // Onboarded but its screen isn't live yet — offer the notify waitlist.
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
        ) : venue.categoryFull ? (
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
