'use client'

import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { ConfirmButton } from '@/components/app/ConfirmButton'
import { removeLocation } from './screens/actions'

// Host control on each venue card. Removing a location deletes it and its screen
// together. Blocked (server-side too) while paid advertiser ads are running —
// here we just surface that state instead of offering the button.
export function RemoveLocationButton({
  venueId,
  paidAdCount,
}: {
  venueId: string
  paidAdCount: number
}) {
  const router = useRouter()

  if (paidAdCount > 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {paidAdCount} paid ad{paidAdCount === 1 ? '' : 's'} running · contact us to remove
      </span>
    )
  }

  return (
    <ConfirmButton
      onConfirm={async () => {
        const res = await removeLocation(venueId)
        if (!res.error) router.refresh()
        return res
      }}
      title="Remove this location?"
      description="This deletes the location and its screen. This can’t be undone."
      confirmText="Remove"
      successToast="Location removed"
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      aria-label="Remove location"
    >
      <Trash2 className="size-4" /> Remove
    </ConfirmButton>
  )
}
