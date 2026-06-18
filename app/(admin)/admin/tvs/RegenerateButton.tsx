'use client'

import { useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { regeneratePairingCode } from './actions'

export function RegenerateButton({ id }: { id: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      aria-label="Regenerate pairing code"
      title="New pairing code (unpairs the screen, then re-pair the Pi)"
      onClick={() => {
        if (
          !window.confirm(
            'Issue a new pairing code? This unpairs the current screen — a technician must re-pair the Pi with the new code.'
          )
        )
          return
        start(async () => {
          const res = await regeneratePairingCode(id)
          if (res.error) toast.error(res.error)
          else toast.success('New pairing code issued — pair the Pi with it on-site')
        })
      }}
    >
      <RefreshCw className="size-4" />
    </Button>
  )
}
