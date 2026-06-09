'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { setVenueStatus } from './actions'

// Quick show/hide for a venue. Hidden (inactive) venues gray out in admin and
// drop off the advertiser map — for staging locations that aren't ready.
export function VisibilityToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      aria-label={active ? 'Hide venue' : 'Show venue'}
      title={active ? 'Hide (not ready)' : 'Show on map'}
      onClick={() =>
        start(async () => {
          const res = await setVenueStatus(id, active ? 'inactive' : 'active')
          if (res.error) toast.error(res.error)
          else {
            toast.success(active ? 'Hidden — off the map' : 'Live on the map')
            router.refresh()
          }
        })
      }
    >
      {active ? <Eye className="size-4" /> : <EyeOff className="size-4 text-muted-foreground" />}
    </Button>
  )
}
