'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/admin/ConfirmButton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { addPlacement, removePlacement } from '../tvs/[id]/actions'
import { setHostVenue } from './actions'
import type { ScreenOption, Spot, VenueOption } from '@/lib/delivery'

// Take an ad off a screen, or put it on another one, without leaving this page.
// Both reuse the screen page's own actions, so the rules are the same wherever
// you do it: removing records an exclusion so the nightly placement run won't
// put the ad back, and adding only takes an approved ad into a free slot.

export function RemoveSpot({ spot }: { spot: Spot }) {
  const router = useRouter()
  return (
    <ConfirmButton
      variant="ghost"
      size="icon-xs"
      className="-my-0.5 -mr-1 size-4 text-muted-foreground hover:text-destructive"
      aria-label={`Take ${spot.adTitle} off ${spot.screenLabel}`}
      message={`Take ${spot.adTitle} off ${spot.screenLabel}?`}
      description="It stops playing there within about a minute, and the nightly placement run will not put it back. You can add it again any time."
      confirmLabel="Take it off"
      confirmVariant="destructive"
      onConfirm={async () => {
        const { error } = await removePlacement(spot.placementId, spot.tvId)
        if (error) toast.error(error)
        else {
          toast.success(`Off ${spot.screenLabel}`)
          router.refresh()
        }
      }}
    >
      <X />
    </ConfirmButton>
  )
}

export function AddToScreen({
  adId,
  adTitle,
  label,
  onScreens,
  screens,
}: {
  adId: string
  adTitle: string
  /** Names the ad on the button when an advertiser has more than one. */
  label?: string
  /** Screens already carrying this ad, left out of the list. */
  onScreens: string[]
  screens: ScreenOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [tvId, setTvId] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const options = screens.filter((s) => !onScreens.includes(s.tvId))

  if (!open) {
    return (
      <Button variant="outline" size="xs" onClick={() => setOpen(true)} disabled={!options.length}>
        <Plus /> {label ? `Add ${label} to a screen` : 'Add to a screen'}
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={tvId} onValueChange={(v) => setTvId(v)}>
        <SelectTrigger size="sm" className="min-w-52 text-xs">
          <SelectValue>
            {(v: string | null) => options.find((o) => o.tvId === v)?.label ?? 'Pick a screen'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.tvId} value={o.tvId} disabled={o.free === 0}>
              {o.label}
              {o.free === 0 ? ' (full)' : ''}
              {o.dark ? ' (off)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="xs"
        disabled={!tvId || pending}
        onClick={() =>
          start(async () => {
            const { error } = await addPlacement(tvId!, adId)
            if (error) return void toast.error(error)
            toast.success(`${adTitle} added to ${options.find((o) => o.tvId === tvId)?.label}`)
            setOpen(false)
            setTvId(null)
            router.refresh()
          })
        }
      >
        {pending ? 'Adding…' : 'Add'}
      </Button>
      <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  )
}

// Mark an advertiser's ads as a venue host's own ad, or clear it. See
// ../delivery/actions.ts for what that changes (and that screens do not).
export function HostMark({
  adIds,
  hostVenueName,
  suggestedVenueId,
  venues,
}: {
  adIds: string[]
  hostVenueName: string | null
  suggestedVenueId: string | null
  venues: VenueOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [venueId, setVenueId] = useState<string | null>(suggestedVenueId)
  const [pending, start] = useTransition()

  const save = (id: string | null) =>
    start(async () => {
      const { error } = await setHostVenue(adIds, id)
      if (error) return void toast.error(error)
      toast.success(id ? `Marked as host ad for ${venues.find((v) => v.id === id)?.name}` : 'No longer a host ad')
      setOpen(false)
      router.refresh()
    })

  if (hostVenueName) {
    return (
      <span className="inline-flex items-center gap-1">
        <Badge variant="secondary">Host · {hostVenueName}</Badge>
        <ConfirmButton
          variant="ghost"
          size="icon-xs"
          className="size-4 text-muted-foreground"
          aria-label="Not a host ad"
          message="Not a host ad?"
          description="It goes back to being treated as an advertiser's ad. Nothing changes on the screens."
          confirmLabel="Remove host mark"
          onConfirm={() => save(null)}
        >
          <X />
        </ConfirmButton>
      </span>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Mark as host ad
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={venueId} onValueChange={(v) => setVenueId(v)}>
        <SelectTrigger size="sm" className="min-w-44 text-xs">
          <SelectValue>
            {(v: string | null) => venues.find((x) => x.id === v)?.name ?? 'Which venue do they host?'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {venues.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="xs" disabled={!venueId || pending} onClick={() => save(venueId)}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
      <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  )
}
