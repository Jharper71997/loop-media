'use client'

import { useTransition } from 'react'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
      <Button
        size="sm"
        variant="destructive"
        className="flex-1"
        disabled={pending}
        onClick={() => {
          const reason = window.prompt('Reason for rejection (shown to the advertiser):')
          if (reason === null) return
          start(async () => {
            const res = await rejectAd(id, reason)
            if (res.error) toast.error(res.error)
            else toast.success('Ad rejected')
          })
        }}
      >
        <X className="size-4" /> Reject
      </Button>
    </div>
  )
}
