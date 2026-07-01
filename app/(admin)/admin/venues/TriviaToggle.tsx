'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Gamepad2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { setVenueTrivia } from './actions'

// Per-venue trivia on/off. Off = the TV shows no trivia slide at this venue.
// Trivia is off by default; an admin turns it on for the locations that want it.
export function TriviaToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      aria-label={enabled ? 'Turn trivia off' : 'Turn trivia on'}
      title={enabled ? 'Trivia on — running on this venue’s screens' : 'Trivia off — click to run it here'}
      onClick={() =>
        start(async () => {
          const res = await setVenueTrivia(id, !enabled)
          if (res.error) toast.error(res.error)
          else {
            toast.success(enabled ? 'Trivia turned off here' : 'Trivia turned on here')
            router.refresh()
          }
        })
      }
    >
      <Gamepad2 className={enabled ? 'size-4 text-primary' : 'size-4 text-muted-foreground'} />
    </Button>
  )
}
