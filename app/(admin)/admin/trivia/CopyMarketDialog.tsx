'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { copyTriviaToMarkets } from './actions'

// Give a new market a local bank by copying one it should share.
//
// The case is a second city in the same state: "Pepsi was invented in which NC
// city" is exactly as local two towns over, and nobody is going to re-type forty
// of those. Copies, so the new market can then drop the ones that don't travel.
export function CopyMarketDialog({
  markets,
  defaultToId,
}: {
  // Markets with a local bank worth copying, and how big each one is.
  markets: { id: string; name: string; localCount: number }[]
  defaultToId: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const withQuestions = markets.filter((m) => m.localCount > 0)
  const [from, setFrom] = useState(withQuestions[0]?.id ?? '')
  const [to, setTo] = useState<string[]>(
    defaultToId && defaultToId !== withQuestions[0]?.id ? [defaultToId] : []
  )
  const [pending, start] = useTransition()

  const toggle = (id: string) =>
    setTo((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = await copyTriviaToMarkets({ fromTerritoryId: from, toTerritoryIds: to })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        res.added
          ? `Copied ${res.added} question${res.added === 1 ? '' : 's'}.`
          : 'Nothing to copy — those markets already have all of them.'
      )
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" disabled={!withQuestions.length} />}>
        <Copy className="size-4" /> Copy between markets
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy local questions</DialogTitle>
          <DialogDescription>
            Give a new city the bank a nearby one already has. Anything the target market already
            asks is skipped.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Copy from</Label>
            <Select value={from} onValueChange={(v) => setFrom(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) => {
                    const m = withQuestions.find((x) => x.id === v)
                    return m ? `${m.name} (${m.localCount})` : 'Pick a market'
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {withQuestions.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} ({m.localCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Copy into</Label>
            {markets
              .filter((m) => m.id !== from)
              .map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={to.includes(m.id)} onCheckedChange={() => toggle(m.id)} />
                  <span>{m.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.localCount ? `${m.localCount} local` : 'none yet'}
                  </span>
                </label>
              ))}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !from || !to.length}>
              {pending ? 'Copying…' : 'Copy questions'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
