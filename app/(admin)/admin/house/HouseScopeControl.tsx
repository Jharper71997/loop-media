'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { HouseKind, HouseSetting } from '@/lib/houseSlides'
import { setHouseSetting } from './actions'

// Where one house slide plays, for one market — or, with `territoryId` null, for
// the whole network.
//
// A segmented control rather than a dropdown because there are only ever two or
// three states and the current one has to be readable at a glance down a column of
// markets: the question the admin came here with is "which markets is this NOT
// playing in", and that should be answerable without opening anything.
//
// A scope holding an upload shows a fourth, unlisted state — picking any of these
// retires that upload (it stays in the history below and can be put back).
export function HouseScopeControl({
  kind,
  territoryId,
  value,
  disabled,
  label,
}: {
  kind: HouseKind
  territoryId: string | null
  value: HouseSetting | 'creative'
  disabled?: boolean
  // What this scope is, in words, for the confirmation toast.
  label: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  // The network row has no "follow" state — it IS the default everything else
  // follows — so it offers the built-in design or off, and nothing between.
  const options: { setting: HouseSetting; label: string; toast: string }[] = territoryId
    ? [
        { setting: 'default', label: 'Follow network', toast: `${label} follows the network default.` },
        { setting: 'builtin', label: 'Built-in', toast: `The built-in slide plays in ${label}.` },
        { setting: 'off', label: 'Off', toast: `Not playing in ${label}.` },
      ]
    : [
        { setting: 'default', label: 'Built-in', toast: 'The built-in slide plays everywhere.' },
        { setting: 'off', label: 'Off everywhere', toast: 'Off on every screen.' },
      ]

  return (
    <div
      className={cn(
        'inline-flex shrink-0 overflow-hidden rounded-md border border-border',
        (pending || disabled) && 'opacity-60'
      )}
    >
      {options.map((o) => {
        const active = value === o.setting
        return (
          <button
            key={o.setting}
            type="button"
            disabled={pending || disabled || active}
            onClick={() =>
              start(async () => {
                const res = await setHouseSetting({ kind, territoryId, setting: o.setting })
                if (res.error) toast.error(res.error)
                else {
                  toast.success(o.toast)
                  router.refresh()
                }
              })
            }
            className={cn(
              'px-2.5 py-1 text-[11px] transition-colors',
              'border-r border-border last:border-r-0',
              active
                ? o.setting === 'off'
                  ? 'bg-destructive/15 font-medium text-destructive'
                  : 'bg-primary/10 font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              (disabled || pending) && 'cursor-not-allowed'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
