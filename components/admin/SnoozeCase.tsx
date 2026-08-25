'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Clock, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { SNOOZE_OPTIONS } from '@/lib/caseTypes'
import { dismissCases, restoreCase } from '@/app/(admin)/admin/case-actions'
import type { Case } from '@/lib/caseTypes'
import { cn } from '@/lib/utils'

// The clear button. The board's whole credibility rests on this: a list that
// cannot be emptied is a list you stop reading, and until now handling a case
// changed nothing on screen because every case is recomputed from live data.
//
// It sits OUTSIDE the row's link, and stops propagation, because the row is a
// single big tap target on a phone and the one thing worse than not being able
// to clear a case is opening it every time you try.

export function SnoozeCase({ c, compact }: { c: Case; compact?: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function snooze(days: number | null, label: string) {
    start(async () => {
      const res = await dismissCases(
        [{ caseId: c.id, severity: c.severity, moneyCents: c.moneyCents }],
        days
      )
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`${c.title} · ${label}`, {
        action: {
          label: 'Undo',
          onClick: () =>
            start(async () => {
              await restoreCase(c.id)
              router.refresh()
            }),
        },
      })
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // stopPropagation only. The trigger is a SIBLING of the row link, not
        // inside it, so there is no navigation to suppress — and calling
        // preventDefault here would eat the click base-ui needs to open the menu.
        onClick={(e) => e.stopPropagation()}
        disabled={pending}
        aria-label={`Clear ${c.title}`}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40',
          // A 40px target on touch, tighter on a pointer.
          compact ? 'size-8' : 'size-10 md:size-8'
        )}
      >
        <Check className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>Clear this off the board</DropdownMenuLabel>
        {SNOOZE_OPTIONS.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => snooze(o.days, o.label)}>
            <Clock className="size-3.5 opacity-60" />
            {o.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/* Said plainly, because a snooze you cannot trust is one you will not
            use — and one you trust too much is how a dark screen stays dark. */}
        <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          Comes back on its own if it gets worse or the money grows.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The way back: shown on the Snoozed view. */
export function RestoreCase({ caseId, label }: { caseId: string; label: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Put ${label} back on the board`}
      onClick={(e) => {
        e.stopPropagation()
        start(async () => {
          const res = await restoreCase(caseId)
          if (res.error) {
            toast.error(res.error)
            return
          }
          toast.success(`${label} · back on the board`)
          router.refresh()
        })
      }}
      className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 md:size-8"
    >
      <Undo2 className="size-4" />
    </button>
  )
}
