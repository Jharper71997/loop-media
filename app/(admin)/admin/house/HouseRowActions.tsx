'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pause, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { clearHouseCreative, toggleHouseCreative } from './actions'

// Pause / resume / remove one uploaded house creative. Removing it restores the
// built-in designed slide rather than leaving a gap, so there's nothing destructive
// to confirm — worst case the admin re-uploads.
export function HouseRowActions({ id, active }: { id: string; active: boolean }) {
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

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          run(
            () => toggleHouseCreative(id, !active),
            active ? 'Paused — the built-in slide is back.' : 'Live on the screens.'
          )
        }
      >
        {active ? <Pause className="size-4" /> : <Play className="size-4" />}
        <span className="ml-2">{active ? 'Pause' : 'Use this'}</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => clearHouseCreative(id), 'Removed — the built-in slide is back.')}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}
