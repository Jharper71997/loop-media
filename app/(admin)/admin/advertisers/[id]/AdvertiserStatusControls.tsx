'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, RotateCcw, Gift } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmButton } from '@/components/admin/ConfirmButton'
import {
  deactivateAdvertiser,
  reactivateAdvertiser,
  grantFreeWeekCredit,
  revokeFreeWeekCredit,
} from './actions'

// Reversible hold on an advertiser (Deactivate/Reactivate) + the "free week"
// credit toggle. The credit works even with zero campaigns: their next campaign
// runs free for 7 days (submitCampaign honors it), then auto-stops.
export function AdvertiserStatusControls({
  id,
  deactivated,
  freeWeekCredit = false,
}: {
  id: string
  deactivated: boolean
  freeWeekCredit?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ error?: string | null }>, okMsg: string) =>
    start(async () => {
      const res = await fn()
      if (res.error) toast.error(res.error)
      else {
        toast.success(okMsg)
        router.refresh()
      }
    })

  return (
    <div className="flex flex-wrap gap-2">
      {deactivated ? (
        <ConfirmButton
          variant="outline"
          size="sm"
          disabled={pending}
          message="Reactivate this advertiser?"
          description="Restores their login, resumes billing, and puts their ads back on screens."
          confirmLabel="Reactivate"
          onConfirm={() => run(() => reactivateAdvertiser(id), 'Advertiser reactivated')}
        >
          <RotateCcw className="size-4" /> Reactivate
        </ConfirmButton>
      ) : (
        <ConfirmButton
          variant="outline"
          size="sm"
          disabled={pending}
          message="Deactivate this advertiser?"
          description="Blocks their login, pauses their Stripe billing, and takes their ads off screens. Nothing is deleted — reactivate anytime."
          confirmLabel="Deactivate"
          confirmVariant="destructive"
          onConfirm={() => run(() => deactivateAdvertiser(id), 'Advertiser deactivated')}
        >
          <Ban className="size-4" /> Deactivate
        </ConfirmButton>
      )}

      {freeWeekCredit ? (
        <ConfirmButton
          variant="outline"
          size="sm"
          disabled={pending}
          message="Remove this advertiser's unused free-week credit?"
          confirmLabel="Remove credit"
          onConfirm={() => run(() => revokeFreeWeekCredit(id), 'Free-week credit removed')}
        >
          <Gift className="size-4" /> Free week: ready
        </ConfirmButton>
      ) : (
        <ConfirmButton
          variant="outline"
          size="sm"
          disabled={pending}
          message="Give this advertiser a free week? Their next campaign runs free for 7 days (no charge), then auto-stops. Their ad still goes through review before it airs."
          confirmLabel="Grant free week"
          onConfirm={() => run(() => grantFreeWeekCredit(id), 'Free week granted')}
        >
          <Gift className="size-4" /> Give free week
        </ConfirmButton>
      )}
    </div>
  )
}
