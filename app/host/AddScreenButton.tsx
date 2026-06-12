'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { addScreen } from './screens/actions'

// Host self-provisions another screen on one of their venues. On success a new
// pairing code appears on the venue card (rendered by the host dashboard).
export function AddScreenButton({ venueId }: { venueId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await addScreen(venueId)
          if (res.error) toast.error(res.error)
          else {
            toast.success('Screen added — enter its pairing code on the TV.')
            router.refresh()
          }
        })
      }
    >
      <Plus className="size-4" /> Add a screen
    </Button>
  )
}
