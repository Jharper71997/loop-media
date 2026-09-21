'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MonitorX, Plus, Power, RefreshCw, RotateCcw, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  updateTvLoop,
  addPlacement,
  removePlacement,
  updateAdDuration,
  setAllAdDurations,
  updateHouseSlideSeconds,
  updateOverscan,
  sendTvCommand,
  setSleepWhenClosed,
} from './actions'

// --- Loop capacity: how many AD slots this screen sells + seconds per slot ---
// The admin sets the number of ad spots (what advertisers can buy) and the per-slot
// timing; we store loop_length = slots × seconds. The always-on house slides play
// on top, so the live panel shows the real loop: ad slots + house = total slides,
// how long a full loop runs, and how many spots are open right now.
export function LoopConfig({
  id,
  adSlots,
  slotSeconds,
  houseCount,
  houseSeconds,
  paidSold,
}: {
  id: string
  adSlots: number
  slotSeconds: number
  houseCount: number
  houseSeconds: number
  paidSold: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [slots, setSlots] = useState(adSlots)
  const [slot, setSlot] = useState(slotSeconds)

  const totalSlides = slots + houseCount
  const loopSec = slots * slot + houseSeconds
  const loopLabel = loopSec >= 60 ? `${Math.floor(loopSec / 60)}m ${loopSec % 60}s` : `${loopSec}s`
  const openNow = Math.max(0, slots - paidSold)
  const dirty = (slots !== adSlots || slot !== slotSeconds) && slots >= 1 && slot >= 5

  function save() {
    start(async () => {
      const res = await updateTvLoop(id, { loop_length_seconds: slots * slot, slot_seconds: slot })
      if (res.error) toast.error(res.error)
      else {
        toast.success('Loop capacity updated')
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Ad slots (spots to sell)</Label>
          <Input
            type="number"
            min={1}
            max={96}
            className="h-8 w-28"
            value={slots}
            onChange={(e) => setSlots(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Seconds per slot</Label>
          <Input
            type="number"
            min={5}
            max={600}
            className="h-8 w-28"
            value={slot}
            onChange={(e) => setSlot(Math.max(5, Math.floor(Number(e.target.value) || 15)))}
          />
        </div>
        <Button size="sm" disabled={pending || !dirty} onClick={save}>
          <Save className="size-4" /> Save
        </Button>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-sm">
        <p className="text-foreground">
          <span className="font-medium tabular-nums">{totalSlides}</span> slide
          {totalSlides === 1 ? '' : 's'} in the loop —{' '}
          <span className="tabular-nums">{slots}</span> ad{' '}
          <span className="text-muted-foreground">+ {houseCount} house</span> — running about{' '}
          <span className="font-medium tabular-nums">{loopLabel}</span> per full loop.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Advertisers can buy <span className="font-medium text-foreground tabular-nums">{slots}</span>{' '}
          spot{slots === 1 ? '' : 's'} on this screen ·{' '}
          <span className="tabular-nums">{paidSold}</span> sold ·{' '}
          <span className="font-medium text-foreground tabular-nums">{openNow}</span> open. Video ads
          play their full length; image/house slides use their own seconds.
        </p>
      </div>
    </div>
  )
}

// Per-ad on-screen seconds (ads.duration_seconds). Compact inline field on each
// row of the current loop; the screen picks up the change on its next ~30s sync.
export function AdDurationField({
  tvId,
  adId,
  seconds,
}: {
  tvId: string
  adId: string
  seconds: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [val, setVal] = useState(seconds)
  const dirty = val !== seconds && val > 0
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Input
        type="number"
        min={3}
        max={600}
        aria-label="Seconds on screen"
        className="h-8 w-16"
        value={val}
        onChange={(e) => setVal(Number(e.target.value) || 0)}
      />
      <span className="text-xs text-muted-foreground">sec</span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Save seconds"
        disabled={pending || !dirty}
        onClick={() =>
          start(async () => {
            const res = await updateAdDuration(tvId, adId, val)
            if (res.error) toast.error(res.error)
            else {
              toast.success('Duration updated')
              router.refresh()
            }
          })
        }
      >
        <Save className="size-4" />
      </Button>
    </div>
  )
}

// Per-house-slide on-screen seconds (stored per-screen on the tvs row). Same look
// as AdDurationField; saves via updateHouseSlideSeconds keyed by the slide kind.
export function HouseDurationField({
  tvId,
  slideKind,
  seconds,
}: {
  tvId: string
  slideKind: string
  seconds: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [val, setVal] = useState(seconds)
  const dirty = val !== seconds && val > 0
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Input
        type="number"
        min={3}
        max={600}
        aria-label="Seconds on screen"
        className="h-8 w-16"
        value={val}
        onChange={(e) => setVal(Number(e.target.value) || 0)}
      />
      <span className="text-xs text-muted-foreground">sec</span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Save seconds"
        disabled={pending || !dirty}
        onClick={() =>
          start(async () => {
            const res = await updateHouseSlideSeconds(tvId, slideKind, val)
            if (res.error) toast.error(res.error)
            else {
              toast.success('Duration updated')
              router.refresh()
            }
          })
        }
      >
        <Save className="size-4" />
      </Button>
    </div>
  )
}

// "Apply to all": set one on-screen time for every ad on this screen at once.
export function SetAllDurations({
  tvId,
  defaultSeconds,
}: {
  tvId: string
  defaultSeconds: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [val, setVal] = useState(defaultSeconds)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label className="text-xs text-muted-foreground">Set all ads to</Label>
      <Input
        type="number"
        min={3}
        max={600}
        aria-label="Seconds for all ads"
        className="h-8 w-20"
        value={val}
        onChange={(e) => setVal(Number(e.target.value) || 0)}
      />
      <span className="text-xs text-muted-foreground">sec</span>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !(val > 0)}
        onClick={() =>
          start(async () => {
            const res = await setAllAdDurations(tvId, val)
            if (res.error) toast.error(res.error)
            else {
              toast.success('All ads updated')
              router.refresh()
            }
          })
        }
      >
        Apply to all
      </Button>
    </div>
  )
}

// Per-screen overscan safe-area inset (%). Raise it when this venue's TV zooms past
// its edges and clips the QR / ad edges; 0 = edge-to-edge. The screen picks up the
// change on its next ~30s sync. Use the on-screen "Calibrate" tool at the venue to
// see the cutoff and find the number.
export function OverscanControl({ id, overscan }: { id: string; overscan: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [val, setVal] = useState(overscan)
  const dirty = val !== overscan && val >= 0 && val <= 15
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Overscan safe margin (%)</Label>
        <Input
          type="number"
          min={0}
          max={15}
          className="h-8 w-24"
          value={val}
          onChange={(e) => setVal(Number(e.target.value))}
        />
      </div>
      <Button
        size="sm"
        disabled={pending || !dirty}
        onClick={() =>
          start(async () => {
            const res = await updateOverscan(id, val)
            if (res.error) toast.error(res.error)
            else {
              toast.success('Overscan updated')
              router.refresh()
            }
          })
        }
      >
        <Save className="size-4" /> Save
      </Button>
    </div>
  )
}

export function RemovePlacementButton({ id, tvId }: { id: string; tvId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Remove from loop"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await removePlacement(id, tvId)
          if (res.error) toast.error(res.error)
          else {
            toast.success('Removed from loop')
            router.refresh()
          }
        })
      }
    >
      <X className="size-4 text-destructive" />
    </Button>
  )
}

export function AddPlacement({
  tvId,
  ads,
}: {
  tvId: string
  ads: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [adId, setAdId] = useState('')

  if (ads.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No eligible approved ads to add (every approved ad in this market is already on this screen).
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={adId} onValueChange={(v) => setAdId(v ?? '')}>
        <SelectTrigger className="w-72">
          <SelectValue>
            {(v: string | null) => ads.find((a) => a.id === v)?.label ?? 'Select an ad…'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ads.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={pending || !adId}
        onClick={() =>
          start(async () => {
            const res = await addPlacement(tvId, adId)
            if (res.error) toast.error(res.error)
            else {
              toast.success('Added to loop')
              setAdId('')
              router.refresh()
            }
          })
        }
      >
        <Plus className="size-4" /> Add to loop
      </Button>
    </div>
  )
}

// --- Remote power: turn this screen's panel off and on, and let it keep its own
// hours (migration 0078) --------------------------------------------------
//
// None of these buttons reach the TV directly. A venue's router NATs the screen,
// so nothing can dial in; the screen asks the server for work every ~30s and this
// queues it. That means up to ~30 seconds between the click and the panel, and it
// means a screen that is off the network simply does it when it comes back. The
// command list under these buttons is how you tell those apart.
type ScreenCommand = 'sleep' | 'wake' | 'reload' | 'relaunch'

export function ScreenPower({
  tvId,
  sleepWhenClosed,
  hoursLabel,
}: {
  tvId: string
  sleepWhenClosed: boolean
  hoursLabel: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function send(command: ScreenCommand, done: string) {
    start(async () => {
      const res = await sendTvCommand(tvId, command)
      if (res.error) toast.error(res.error)
      else {
        toast.success(done)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => send('sleep', 'Sleep queued â€” the screen takes it on its next sync.')}
        >
          <Power className="size-4" /> Turn screen off
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => send('wake', 'Wake queued â€” the screen takes it within a minute.')}
        >
          <Power className="size-4" /> Turn screen on
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => send('reload', 'Reload queued.')}
        >
          <RefreshCw className="size-4" /> Reload the player
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => send('relaunch', 'Restart queued.')}
        >
          <RotateCcw className="size-4" /> Restart the app
        </Button>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm text-foreground">
              {sleepWhenClosed
                ? 'This screen sleeps when the venue is closed.'
                : 'This screen stays on 24/7.'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hoursLabel
                ? `Venue hours: ${hoursLabel}. The screen wakes itself a few minutes before open and sleeps at close, on its own alarm â€” so it keeps the schedule even if the internet is down.`
                : 'Set this venueâ€™s open hours first, or the screen has no schedule to keep.'}
            </p>
          </div>
          <Button
            size="sm"
            variant={sleepWhenClosed ? 'outline' : 'default'}
            disabled={pending || (!sleepWhenClosed && !hoursLabel)}
            onClick={() =>
              start(async () => {
                const res = await setSleepWhenClosed(tvId, !sleepWhenClosed)
                if (res.error) toast.error(res.error)
                else {
                  toast.success(
                    sleepWhenClosed
                      ? 'Back to 24/7 â€” a wake is on its way to the screen.'
                      : 'Scheduled. The screen picks up its hours on the next sync.'
                  )
                  router.refresh()
                }
              })
            }
          >
            <MonitorX className="size-4" />
            {sleepWhenClosed ? 'Keep it on 24/7' : 'Sleep when closed'}
          </Button>
        </div>
      </div>
    </div>
  )
}
