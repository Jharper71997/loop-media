'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmButton } from '@/components/admin/ConfirmButton'
import { deactivateAdvertiser, reactivateAdvertiser } from './actions'

// Reversible hold on an advertiser. Deactivate pauses billing + ads and blocks
// login; Reactivate restores it all. Distinct from the permanent Delete next to it.
export function AdvertiserStatusControls({
  id,
  deactivated,
}: {
  id: string
  deactivated: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  if (deactivated) {
    return (
      <ConfirmButton
        variant="outline"
        size="sm"
        disabled={pending}
        message="Reactivate this advertiser?"
        description="Restores their login, resumes billing, and puts their ads back on screens."
        confirmLabel="Reactivate"
        onConfirm={() =>
          start(async () => {
            const res = await reactivateAdvertiser(id)
            if (res.error) toast.error(res.error)
            else {
              toast.success('Advertiser reactivated')
              router.refresh()
            }
          })
        }
      >
        <RotateCcw className="size-4" /> Reactivate
      </ConfirmButton>
    )
  }
  return (
    <ConfirmButton
      variant="outline"
      size="sm"
      disabled={pending}
      message="Deactivate this advertiser?"
      description="Blocks their login, pauses their Stripe billing, and takes their ads off screens. Nothing is deleted — reactivate anytime."
      confirmLabel="Deactivate"
      confirmVariant="destructive"
      onConfirm={() =>
        start(async () => {
          const res = await deactivateAdvertiser(id)
          if (res.error) toast.error(res.error)
          else {
            toast.success('Advertiser deactivated')
            router.refresh()
          }
        })
      }
    >
      <Ban className="size-4" /> Deactivate
    </ConfirmButton>
  )
}
