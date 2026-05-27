'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { markCampaignPaid } from './actions'

export function ActivateButton({ campaignId }: { campaignId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await markCampaignPaid(campaignId)
          if (res?.error) toast.error(res.error)
          else toast.success('Campaign activated')
        })
      }
    >
      {pending ? 'Activating…' : 'Mark paid & activate'}
    </Button>
  )
}
