'use client'

import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createTv } from './actions'

type VenueOption = { id: string; name: string }

export function TvDialog({ venues }: { venues: VenueOption[] }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [venueId, setVenueId] = useState('')
  const [loopLen, setLoopLen] = useState(360)
  const [slot, setSlot] = useState(15)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!venueId) {
      toast.error('Pick a venue.')
      return
    }
    start(async () => {
      const res = await createTv({
        venue_id: venueId,
        loop_length_seconds: loopLen,
        slot_seconds: slot,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Screen created — copy its link onto the Pi.')
      setOpen(false)
      setVenueId('')
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" disabled={venues.length === 0} />}>
        <Plus className="size-4" /> New TV
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New TV</DialogTitle>
          <DialogDescription>
            Creates a screen with a link to program onto its Pi before you ship it. No pairing
            needed — it goes live on its own once it&apos;s plugged in.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Venue</Label>
            <Select value={venueId} onValueChange={(v) => setVenueId(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    venues.find((x) => x.id === v)?.name ?? 'Select a venue…'}
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
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Loop length (sec)</Label>
              <Input
                type="number"
                min={60}
                value={loopLen}
                onChange={(e) => setLoopLen(Number(e.target.value) || 360)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Slot length (sec)</Label>
              <Input
                type="number"
                min={5}
                value={slot}
                onChange={(e) => setSlot(Number(e.target.value) || 15)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create TV'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
