'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { resetDemo } from '@/app/(admin)/admin/demo-actions'

// Admin utility: wipe every throwaway demo account + its data in one click. Demo
// runs also self-purge (anything older than a few hours) whenever a new one
// starts, so this is just for an immediate reset before a call.
export function ResetDemoButton() {
  const [loading, setLoading] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={loading}
      onClick={async () => {
        setLoading(true)
        const res = await resetDemo()
        setLoading(false)
        if ('error' in res) {
          toast.error(res.error)
        } else {
          toast.success(
            res.removed
              ? `Cleared ${res.removed} demo account${res.removed === 1 ? '' : 's'}.`
              : 'No demo data to clear.'
          )
        }
      }}
    >
      {loading ? 'Clearing…' : 'Reset all demo data'}
    </Button>
  )
}
