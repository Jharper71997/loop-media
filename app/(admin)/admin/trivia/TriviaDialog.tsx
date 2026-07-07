'use client'

import { useState, useTransition } from 'react'
import { Pencil, Plus } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { saveTriviaQuestion, type TriviaInput } from './actions'

const NONE = 'none'

type Existing = {
  id: string
  prompt: string
  choices: string[]
  correct_idx: number
  territory_id: string | null
  venue_id: string | null
}

export function TriviaDialog({
  territories,
  venues,
  existing,
}: {
  territories: { id: string; name: string }[]
  venues: { id: string; name: string; territory_id: string }[]
  existing?: Existing
}) {
  const isEdit = !!existing
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  const [prompt, setPrompt] = useState(existing?.prompt ?? '')
  const [choices, setChoices] = useState<string[]>(
    existing?.choices?.length === 4 ? existing.choices : ['', '', '', '']
  )
  const [correct, setCorrect] = useState(existing?.correct_idx ?? 0)
  const [territoryId, setTerritoryId] = useState<string>(existing?.territory_id ?? NONE)
  const [venueId, setVenueId] = useState<string>(existing?.venue_id ?? NONE)

  // Only offer venues in the chosen market (or all when market = global).
  const venueOptions =
    territoryId === NONE ? venues : venues.filter((v) => v.territory_id === territoryId)

  function setChoice(i: number, v: string) {
    setChoices((c) => c.map((x, idx) => (idx === i ? v : x)))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const input: TriviaInput = {
        id: existing?.id,
        prompt,
        choices,
        correct_idx: correct,
        territory_id: territoryId === NONE ? null : territoryId,
        venue_id: venueId === NONE ? null : venueId,
      }
      const res = await saveTriviaQuestion(input)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(isEdit ? 'Question updated' : 'Question added')
      setOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="ghost" size="icon-sm" aria-label="Edit question" />
          ) : (
            <Button size="sm" />
          )
        }
      >
        {isEdit ? <Pencil className="size-4" /> : <><Plus className="size-4" /> New question</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit question' : 'New question'}</DialogTitle>
          <DialogDescription>
            A phone-trivia question. Mark the correct answer and, optionally, scope it to a market or
            a single venue.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Question</Label>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} required />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Answers (pick the correct one)</Label>
            {choices.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Mark answer ${i + 1} correct`}
                  aria-pressed={correct === i}
                  onClick={() => setCorrect(i)}
                  className={
                    'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs transition-colors ' +
                    (correct === i
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/50')
                  }
                >
                  {String.fromCharCode(65 + i)}
                </button>
                <Input
                  value={c}
                  onChange={(e) => setChoice(i, e.target.value)}
                  placeholder={`Answer ${i + 1}`}
                  required
                />
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Market</Label>
              <Select
                value={territoryId}
                onValueChange={(v) => {
                  setTerritoryId(v ?? NONE)
                  setVenueId(NONE)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string | null) =>
                      v && v !== NONE ? territories.find((t) => t.id === v)?.name ?? '—' : 'All markets'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>All markets (global)</SelectItem>
                  {territories.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Venue</Label>
              <Select value={venueId} onValueChange={(v) => setVenueId(v ?? NONE)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string | null) =>
                      v && v !== NONE ? venues.find((x) => x.id === v)?.name ?? '—' : 'All venues'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>All venues</SelectItem>
                  {venueOptions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add question'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
