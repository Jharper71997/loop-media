'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pause, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { pauseCampaign, resumeCampaign, cancelCampaign } from './actions'

export function CampaignControls({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const run = (fn: (id: string) => Promise<{ error: string | null }>, ok: string) =>
    start(async () => {
      const res = await fn(id)
      if (res.error) toast.error(res.error)
      else {
        toast.success(ok)
        router.refresh()
      }
    })

  if (status === 'canceled') {
    return <span className="text-sm text-muted-foreground">This campaign is canceled.</span>
  }

  return (
    <div className="flex gap-2">
      {status === 'paused' ? (
        <Button disabled={pending} onClick={() => run(resumeCampaign, 'Campaign resumed')}>
          <Play className="size-4" /> Resume
        </Button>
      ) : (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(pauseCampaign, 'Campaign paused')}
        >
          <Pause className="size-4" /> Pause
        </Button>
      )}
      <Button
        variant="destructive"
        disabled={pending}
        onClick={() => {
          if (window.confirm('Cancel this campaign? Your ad will stop running.')) {
            run(cancelCampaign, 'Campaign canceled')
          }
        }}
      >
        <X className="size-4" /> Cancel
      </Button>
    </div>
  )
}
