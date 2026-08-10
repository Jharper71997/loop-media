'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCents } from '@/lib/format'
import type { MoveContext } from '@/lib/moveScreen'
import { moveScreen } from '@/app/(admin)/admin/cases/[kind]/[id]/move-actions'

// Move an ad off a screen, from the page that told you the screen was broken.
//
// The whole point is that the fix happens where the problem is proven. So this
// answers the only two questions standing between you and doing it: where can it
// go, and does it change what they pay. Both are on screen before you commit,
// and the price shown is the one the server re-derives and enforces.

export function MoveScreen({ context }: { context: MoveContext }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [venueId, setVenueId] = useState<string | null>(
    context.destinations[0]?.venueId ?? null
  )
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const picked = context.destinations.find((d) => d.venueId === venueId) ?? null

  if (!context.destinations.length) {
    return (
      <p className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground">
        {context.note ?? 'There is nowhere to move this ad right now.'}
      </p>
    )
  }

  function go() {
    if (!picked) return
    setError(null)
    startTransition(async () => {
      const res = await moveScreen(
        context.campaignId,
        context.fromVenueId,
        picked.venueId,
        picked.deltaCents
      )
      if (res.error) {
        setError(res.error)
        return
      }
      const m = res.moved
      setDone(
        m
          ? `Moved to ${m.toVenueName}.${m.warning ? ` ${m.warning}` : ''} ${
              m.deltaCents === 0
                ? 'Their bill is unchanged.'
                : `Their bill is now ${formatCents(m.newMonthlyCents)}/mo.`
            }`
          : 'Moved.'
      )
      router.refresh()
    })
  }

  if (done) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/5 px-3 py-2.5 text-sm">
        <Check className="mt-0.5 size-4 shrink-0 text-success" />
        <span>{done}</span>
      </p>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="truncate font-medium">{context.fromVenueName}</span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        <Select value={venueId} onValueChange={(v) => setVenueId(v)}>
          <SelectTrigger className="min-w-56">
            <SelectValue>
              {(v: string | null) =>
                context.destinations.find((d) => d.venueId === v)?.name ?? 'Pick a venue'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {context.destinations.map((d) => (
              <SelectItem key={d.venueId} value={d.venueId}>
                {d.name}
                {' · '}
                {d.liveScreens > 0
                  ? `${d.liveScreens} of ${d.screens} live`
                  : `${d.screens} screen${d.screens === 1 ? '' : 's'}, none live`}
                {d.deltaCents === 0 ? '' : ` · ${d.deltaCents > 0 ? '+' : '−'}${formatCents(Math.abs(d.deltaCents))}/mo`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {picked && (
        <p className="text-xs text-muted-foreground">
          {picked.deltaCents === 0 ? (
            <>
              Price holds at{' '}
              <span className="font-mono tabular-nums text-foreground">
                {formatCents(context.currentMonthlyCents)}
              </span>
              /mo. Same tier, so nothing about their bill changes.
            </>
          ) : (
            <span className="text-warning">
              This changes their bill: {picked.deltaCents > 0 ? '+' : '−'}
              <span className="font-mono tabular-nums">
                {formatCents(Math.abs(picked.deltaCents))}
              </span>
              /mo, to {formatCents(picked.newMonthlyCents)}/mo, prorated. Different tier from{' '}
              {context.fromVenueName}.
            </span>
          )}
          {picked.liveScreens === 0 && (
            <>
              {' '}
              Nothing at {picked.name} is checking in either — the ad will sit there until that
              screen is fixed.
            </>
          )}
        </p>
      )}

      {error && (
        <p className="flex items-start gap-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <Button size="sm" onClick={go} disabled={pending || !picked}>
        {pending ? 'Moving…' : `Move ${context.adTitle} to ${picked?.name ?? '…'}`}
      </Button>
    </div>
  )
}
