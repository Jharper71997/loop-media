'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Save, X } from 'lucide-react'
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
} from './actions'

// --- edit loop length + slot length (the per-screen inventory cap) ---
export function TvLoopControls({
  id,
  loopLength,
  slotSeconds,
}: {
  id: string
  loopLength: number
  slotSeconds: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [loop, setLoop] = useState(loopLength)
  const [slot, setSlot] = useState(slotSeconds)
  const slots = Math.max(1, Math.floor((loop || 360) / (slot || 15)))

  function save() {
    start(async () => {
      const res = await updateTvLoop(id, { loop_length_seconds: loop, slot_seconds: slot })
      if (res.error) toast.error(res.error)
      else {
        toast.success('Loop updated')
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Loop length (sec)</Label>
        <Input
          type="number"
          min={60}
          className="h-8 w-28"
          value={loop}
          onChange={(e) => setLoop(Number(e.target.value) || 360)}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Slot length (sec)</Label>
        <Input
          type="number"
          min={5}
          className="h-8 w-28"
          value={slot}
          onChange={(e) => setSlot(Number(e.target.value) || 15)}
        />
      </div>
      <p className="pb-1.5 text-sm text-muted-foreground">
        = <span className="font-medium text-foreground tabular-nums">{slots}</span> ad slots
      </p>
      <Button
        size="sm"
        disabled={pending || (loop === loopLength && slot === slotSeconds)}
        onClick={save}
      >
        <Save className="size-4" /> Save
      </Button>
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
