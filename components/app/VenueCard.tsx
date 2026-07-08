'use client'

import { Plus, Check, Bell, BellRing, MapPin } from 'lucide-react'
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
  open: number
  comingSoon: boolean
  // Miles from the advertiser (browse map only). Undefined when we don't know
  // their location; drives the "X mi away" hint on nearby recommendations.
  distanceMi?: number | null
}

// One tappable business in the build flow. Tapping the card adds/removes when
// available; screens whose TV isn't live yet offer a notify-me waitlist instead.
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
        {venue.comingSoon && (
          <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {waitlisted
              ? "Coming soon · we'll email you the day it goes live"
              : 'Coming soon · screen not live yet'}
          </span>
        )}
        {!venue.comingSoon && !venue.ownCategory && venue.open > 0 && (
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
