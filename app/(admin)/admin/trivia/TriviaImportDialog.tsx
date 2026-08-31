'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { parseTriviaBatch, TRIVIA_IMPORT_EXAMPLE } from '@/lib/triviaImport'
import { importTriviaQuestions } from './actions'

const GLOBAL = 'global'

// Paste a market's whole local bank in one go.
//
// The text is parsed as it is typed and the result shown before anything is
// written, because the failure mode of a paste box is silently importing nine of
// the forty lines you meant. Bad lines are named individually — a stray pipe
// inside a question is the usual culprit and is invisible otherwise.
export function TriviaImportDialog({
  territories,
  defaultTerritoryId,
}: {
  territories: { id: string; name: string }[]
  defaultTerritoryId: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [scope, setScope] = useState(defaultTerritoryId ?? GLOBAL)
  const [pending, start] = useTransition()

  const parsed = useMemo(() => parseTriviaBatch(text), [text])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = await importTriviaQuestions({
        territoryId: scope === GLOBAL ? null : scope,
        text,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        `Added ${res.added} question${res.added === 1 ? '' : 's'}` +
          (res.skipped ? ` · skipped ${res.skipped} already in the bank or unreadable` : '')
      )
      setText('')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Upload className="size-4" /> Import
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import questions</DialogTitle>
          <DialogDescription>
            One question per line: question, four answers, then the correct letter — separated by
            | or by tabs, so a paste straight out of a spreadsheet works.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Add them to</Label>
            <Select value={scope} onValueChange={(v) => setScope(v ?? GLOBAL)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    v && v !== GLOBAL
                      ? territories.find((t) => t.id === v)?.name ?? '—'
                      : 'All markets (global)'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GLOBAL}>All markets (global)</SelectItem>
                {territories.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Questions</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder={TRIVIA_IMPORT_EXAMPLE}
            />
          </div>

          {text.trim() && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
              <p className="font-medium">
                {parsed.questions.length} question{parsed.questions.length === 1 ? '' : 's'} ready
                {parsed.bad.length > 0 && ` · ${parsed.bad.length} line(s) can't be read`}
              </p>
              {parsed.bad.slice(0, 5).map((b) => (
                <p key={b.line} className="mt-1 text-muted-foreground">
                  Line {b.line}: {b.reason}
                </p>
              ))}
              {parsed.bad.length > 5 && (
                <p className="mt-1 text-muted-foreground">
                  …and {parsed.bad.length - 5} more.
                </p>
              )}
              <p className="mt-2 text-muted-foreground">
                Questions this market already asks are skipped, so re-pasting a list is safe.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending || !parsed.questions.length}>
              {pending
                ? 'Adding…'
                : `Add ${parsed.questions.length || ''} question${parsed.questions.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
