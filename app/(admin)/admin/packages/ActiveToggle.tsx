'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { togglePackageActive } from './actions'

export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant={active ? 'default' : 'outline'}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await togglePackageActive(id, !active)
          if (res.error) toast.error(res.error)
          else {
            toast.success(active ? 'Package hidden' : 'Package active')
            router.refresh()
          }
        })
      }
    >
      {active ? 'Active' : 'Inactive'}
    </Button>
  )
}
