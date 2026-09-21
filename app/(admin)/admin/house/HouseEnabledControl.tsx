'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { setHouseSlideEnabled, clearHouseSlideEnabled, type HouseKind } from './actions'

// Take a house slide off the screens, or put it back — for the whole network, or
// for the market currently selected in the switcher. Nothing destructive happens
// either way (the slide is a Loop Network house ad, not a paying advertiser's), and
// screens re-read within ~30s, so there's no confirm step.
export function HouseEnabledControl({
  kind,
  label,
  territoryId,
  territoryName,
  enabled,
  hasOwnSetting,
}: {
  kind: HouseKind
  label: string
  territoryId: string | null
  territoryName: string | null
  /** What screens in this scope actually do right now. */
  enabled: boolean
  /** True when THIS scope has its own row (so a market override can be dropped). */
  hasOwnSetting: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ error: string | null }>, ok: string) =>
    start(async () => {
      const res = await fn()
      if (res.error) toast.error(res.error)
      else {
        toast.success(ok)
        router.refresh()
      }
    })

  const where = territoryName ? `in ${territoryName}` : 'on every screen'

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant={enabled ? 'outline' : 'default'}
        disabled={pending}
        aria-label={`${enabled ? 'Take off' : 'Put back on'} the screens ${where}: ${label}`}
        onClick={() =>
          run(
            () => setHouseSlideEnabled({ kind, territoryId, enabled: !enabled }),
            enabled ? `Off ${where}.` : `Back on ${where}.`
          )
        }
      >
        {enabled ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        <span className="ml-2">{enabled ? 'Take off screens' : 'Put back on'}</span>
      </Button>
      {/* Only a MARKET row can be dropped — there's nothing above the network-wide
          setting to fall back to. */}
      {territoryId && hasOwnSetting && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={`Follow the network setting for ${label}`}
          onClick={() =>
            run(
              () => clearHouseSlideEnabled(kind, territoryId),
              'Following the network setting again.'
            )
          }
        >
          <Undo2 className="size-4" />
          <span className="ml-2">Follow network</span>
        </Button>
      )}
    </div>
  )
}
