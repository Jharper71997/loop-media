'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Pause, Play, Trash2, Archive, Plus, CreditCard } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmButton } from '@/components/app/ConfirmButton'
import { useBasePath, homeFor } from '@/lib/useBasePath'
import { cn } from '@/lib/utils'
import { pauseCampaign, resumeCampaign, trashCampaign, archiveCampaign, resumeCheckout } from './actions'

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

  // Draft = created but never paid for. Re-open Stripe so they can finish without
  // rebuilding (the campaign + venues are already saved).
  const resume = () =>
    start(async () => {
      const res = await resumeCheckout(id, base)
      if (res.error) toast.error(res.error)
      else if (res.checkoutUrl) window.location.href = res.checkoutUrl
    })

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'draft' && (
        <Button disabled={pending} onClick={resume}>
          <CreditCard className="size-4" /> Resume payment
        </Button>
      )}
      {/* Add more screens to this live campaign (prorated). Advertiser shell only
          — the host advertise tree doesn't carry this subpage. */}
      {status === 'active' && base === '/advertiser' && (
        <Link href={`/advertiser/campaigns/${id}/add`} className={cn(buttonVariants(), 'gap-1.5')}>
          <Plus className="size-4" /> Add screens
        </Link>
      )}
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
