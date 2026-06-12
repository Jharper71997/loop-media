'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pause, Play, Trash2, Archive } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { pauseCampaign, resumeCampaign, trashCampaign, archiveCampaign } from './actions'

export function CampaignControls({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const run = (fn: (id: string) => Promise<{ error: string | null }>, ok: string, to?: string) =>
    start(async () => {
      const res = await fn(id)
      if (res.error) toast.error(res.error)
      else {
        toast.success(ok)
        if (to) router.push(to)
        else router.refresh()
      }
    })

  return (
    <div className="flex gap-2">
      {status === 'paused' && (
        <Button disabled={pending} onClick={() => run(resumeCampaign, 'Campaign resumed')}>
          <Play className="size-4" /> Resume
        </Button>
      )}
      {status === 'active' && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(pauseCampaign, 'Campaign paused')}
        >
          <Pause className="size-4" /> Pause
        </Button>
      )}
      {status !== 'canceled' && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (
              window.confirm(
                'End this campaign and move it to Past campaigns? It stops running but stays saved with its performance.'
              )
            ) {
              run(archiveCampaign, 'Moved to Past campaigns', '/advertiser/past')
            }
          }}
        >
          <Archive className="size-4" /> Archive
        </Button>
      )}
      <Button
        variant="destructive"
        disabled={pending}
        onClick={() => {
          if (
            window.confirm(
              'Move this campaign to Trash? Your ad stops running. It stays saved and you can restore it anytime.'
            )
          ) {
            run(trashCampaign, 'Moved to Trash', '/advertiser')
          }
        }}
      >
        <Trash2 className="size-4" /> Delete
      </Button>
    </div>
  )
}
