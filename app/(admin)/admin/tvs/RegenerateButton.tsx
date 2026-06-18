'use client'

import { useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { resetDevice } from './actions'

export function RegenerateButton({ id }: { id: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      aria-label="Re-provision screen"
      title="New screen link (use when replacing the device)"
      onClick={() => {
        if (
          !window.confirm(
            'Issue a new screen link? The current device stops counting until you re-program a Pi with the new link.'
          )
        )
          return
        start(async () => {
          const res = await resetDevice(id)
          if (res.error) toast.error(res.error)
          else toast.success('New screen link issued — copy it onto the replacement Pi')
        })
      }}
    >
      <RefreshCw className="size-4" />
    </Button>
  )
}
