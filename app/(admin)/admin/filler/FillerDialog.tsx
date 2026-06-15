'use client'

import { useState, useTransition } from 'react'
import { Plus, Pencil } from 'lucide-react'
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
import { saveFiller, type FillerInput, type FillerType } from './actions'

const TYPE_LABELS: Record<FillerType, string> = {
  trivia: 'Trivia',
  event: 'Local event',
  sports: 'Game day',
  promo: 'Featured promo',
}

type Existing = {
  id: string
  type: FillerType
  headline: string
  sub: string
  foot: string
  expires_at: string | null
}

export function FillerDialog({
  territoryId,
  existing,
}: {
  territoryId: string
  existing?: Existing
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [type, setType] = useState<FillerType>(existing?.type ?? 'trivia')
  const [headline, setHeadline] = useState(existing?.headline ?? '')
  const [sub, setSub] = useState(existing?.sub ?? '')
  const [foot, setFoot] = useState(existing?.foot ?? '')
  const [expires, setExpires] = useState(existing?.expires_at?.slice(0, 10) ?? '')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!territoryId) {
      toast.error('Pick a single territory in the sidebar first.')
      return
    }
    if (!headline.trim()) {
      toast.error('Enter a headline.')
      return
    }
    const input: FillerInput = {
      id: existing?.id,
      territory_id: territoryId,
      type,
      headline,
      sub,
      foot,
      expires_at: expires ? new Date(expires).toISOString() : null,
    }
    start(async () => {
      const res = await saveFiller(input)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(existing ? 'Card updated.' : 'Card added to the loop.')
      setOpen(false)
      if (!existing) {
        setHeadline('')
        setSub('')
        setFoot('')
        setExpires('')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          existing ? (
            <Button variant="ghost" size="icon" />
          ) : (
            <Button size="sm" disabled={!territoryId} />
          )
        }
      >
        {existing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> New card</>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit filler card' : 'New filler card'}</DialogTitle>
          <DialogDescription>
            Plays between ads on every screen in this territory. Sub and footnote are optional.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={type} onValueChange={(v) => setType((v as FillerType) ?? 'trivia')}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) => TYPE_LABELS[(v as FillerType) ?? 'trivia']}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABELS) as FillerType[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {TYPE_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Headline</Label>
            <Input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Which NFL team has the most Super Bowl wins?"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Sub (optional)</Label>
            <Input
              value={sub}
              onChange={(e) => setSub(e.target.value)}
              placeholder="Answer: Steelers & Patriots (6 each)"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Footnote (optional)</Label>
              <Input value={foot} onChange={(e) => setFoot(e.target.value)} placeholder="Trivia night Thursdays" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Expires (optional)</Label>
              <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : existing ? 'Save changes' : 'Add card'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
