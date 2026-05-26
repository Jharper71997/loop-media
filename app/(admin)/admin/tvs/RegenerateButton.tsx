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
      title="New pairing code (unpairs current device)"
      onClick={() => {
        if (!window.confirm('Generate a new code? The current device will be unpaired.'))
          return
        start(async () => {
          const res = await regeneratePairingCode(id)
          if (res.error) toast.error(res.error)
          else toast.success('New pairing code generated')
        })
      }}
    >
      <RefreshCw className="size-4" />
    </Button>
  )
}
