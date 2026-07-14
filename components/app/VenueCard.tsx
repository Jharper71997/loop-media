'use client'

import { Plus, Check, Bell, BellRing, MapPin, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCents } from '@/lib/format'
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
  // Cross-category rival in the same conflict group (blocked, different copy).
  conflicting?: boolean
  open: number
  comingSoon: boolean
  // When the venue is open (e.g. "Mon–Fri, 10 AM–10 PM") — when the ad actually
  // plays. Optional/null so non-browse callers can omit it.
  openHours?: string | null
  // Miles from the advertiser (browse map only). Undefined when we don't know
  // their location; drives the "X mi away" hint on nearby recommendations.
  distanceMi?: number | null
}

// One tappable business in the build flow. Tapping the card adds/removes when
// available (offline screens included — the ad runs once the screen is back on);
// only sold-out screens offer a notify-me waitlist instead.
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
  // Live-or-not is operational noise for the buy side — an active venue with open
  // slots is buyable regardless of whether its screen happens to be on right now.
  const addable = !venue.categoryFull && venue.open > 0
  // What this place actually is, so advertisers know where their ad runs.
  const businessType = venue.category ?? venue.venue_type ?? TIER_LABEL[venue.tier]
  const info = [businessType, `${venue.screens} screen${venue.screens === 1 ? '' : 's'}`]
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
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{info}</span>
          {venue.distanceMi != null && (
            <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-foreground">
              <MapPin className="size-3" />
              {venue.distanceMi < 0.1 ? '<0.1' : venue.distanceMi.toFixed(1)} mi
            </span>
          )}
        </div>
        {venue.openHours && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3 shrink-0" />
            <span className="truncate">{venue.openHours}</span>
          </p>
        )}
        {!venue.categoryFull && venue.open > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{venue.open}</span> ad spot
            {venue.open === 1 ? '' : 's'} open
          </p>
        )}
        <div className="mt-1 font-heading text-lg font-bold tabular-nums">
          {formatCents(venue.priceCents)}
          <span className="text-xs font-normal text-muted-foreground">/mo</span>
        </div>
      </div>

      <div className="shrink-0">
        {venue.categoryFull ? (
          // A competing business — a venue never runs a direct competitor, whether
          // it's the exact same line or a rival in the same space (a food/drink
          // venue won't run bars, restaurants, cafes). Nothing to wait for.
          <Badge
            variant="secondary"
            title="A venue won't run ads from a competing business."
          >
            {venue.ownCategory ? 'Same business' : 'Competing business'}
          </Badge>
        ) : venue.open === 0 ? (
          // Sold out — offer the waitlist so they hear when a spot frees up.
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
                <Bell className="size-4" /> Notify
              </>
            )}
          </Button>
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
