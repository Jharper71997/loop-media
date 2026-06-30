'use client'

import { useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmButton } from '@/components/admin/ConfirmButton'

// Reusable row delete. `action` is a server action that takes the row id.
export function DeleteButton({
  id,
  action,
  confirmText = 'Delete this item? This cannot be undone.',
}: {
  id: string
  action: (id: string) => Promise<{ error: string | null }>
  confirmText?: string
}) {
  const [pending, start] = useTransition()
  return (
    <ConfirmButton
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      aria-label="Delete"
      message={confirmText}
      confirmLabel="Delete"
      confirmVariant="destructive"
      onConfirm={() =>
        start(async () => {
          const res = await action(id)
          if (res?.error) toast.error(res.error)
          else toast.success('Deleted')
        })
      }
    >
      <Trash2 className="size-4 text-destructive" />
    </ConfirmButton>
  )
}
