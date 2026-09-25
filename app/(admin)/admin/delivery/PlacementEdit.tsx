'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/admin/ConfirmButton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { addPlacement, removePlacement } from '../tvs/[id]/actions'
import type { ScreenOption, Spot } from '@/lib/delivery'

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
