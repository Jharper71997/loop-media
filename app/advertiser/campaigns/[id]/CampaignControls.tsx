'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pause, Play, Trash2, Archive } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/app/ConfirmButton'
import { useBasePath, homeFor } from '@/lib/useBasePath'
import { pauseCampaign, resumeCampaign, trashCampaign, archiveCampaign } from './actions'

export function CampaignControls({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const base = useBasePath()
  const home = homeFor(base)
  // Hosts have no "Past campaigns" page; send them home (their dashboard).
  const pastHref = base === '/host/advertise' ? '/host' : '/advertiser/past'
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
        <ConfirmButton
          onConfirm={async () => {
            const res = await archiveCampaign(id)
            if (!res.error) router.push(pastHref)
            return res
          }}
          title="End this campaign?"
          description="It stops running and moves to Past campaigns, but stays saved with its performance."
          confirmText="Archive"
          confirmVariant="default"
          successToast="Moved to Past campaigns"
          variant="outline"
          size="default"
        >
          <Archive className="size-4" /> Archive
        </ConfirmButton>
      )}
      <ConfirmButton
        onConfirm={async () => {
          const res = await trashCampaign(id)
          if (!res.error) router.push(home)
          return res
        }}
        title="Move this campaign to Trash?"
        description="Your ad stops running. It stays saved and you can restore it anytime."
        confirmText="Delete"
        successToast="Moved to Trash"
        variant="destructive"
        size="default"
      >
        <Trash2 className="size-4" /> Delete
      </ConfirmButton>
    </div>
  )
}
