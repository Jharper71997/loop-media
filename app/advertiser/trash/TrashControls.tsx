'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { restoreCampaign } from '../campaigns/[id]/actions'

export function RestoreButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await restoreCampaign(id)
          if (res.error) toast.error(res.error)
          else {
            // Land them on the campaign, where "Relaunch & pay" brings it live
            // again (a restored campaign comes back canceled — billing stayed off).
            toast.success('Restored — relaunch it to go live again')
            router.push(`/advertiser/campaigns/${id}`)
          }
        })
      }
    >
      <RotateCcw className="size-4" /> Restore
    </Button>
  )
}
