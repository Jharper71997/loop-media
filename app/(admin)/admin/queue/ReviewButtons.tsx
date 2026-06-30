'use client'

import { useTransition } from 'react'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PromptButton } from '@/components/admin/PromptButton'
import { approveAd, rejectAd } from './actions'

export function ReviewButtons({ id }: { id: string }) {
  const [pending, start] = useTransition()

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        className="flex-1"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await approveAd(id)
            if (res.error) toast.error(res.error)
            else toast.success('Ad approved')
          })
        }
      >
        <Check className="size-4" /> Approve
      </Button>
      <PromptButton
        size="sm"
        variant="destructive"
        className="flex-1"
        disabled={pending}
        message="Reason for rejection (shown to the advertiser):"
        label="Reason"
        placeholder="Shown to the advertiser"
        submitLabel="Reject ad"
        submitVariant="destructive"
        onSubmit={(reason) =>
          start(async () => {
            const res = await rejectAd(id, reason)
            if (res.error) toast.error(res.error)
            else toast.success('Ad rejected')
          })
        }
      >
        <X className="size-4" /> Reject
      </PromptButton>
    </div>
  )
}
