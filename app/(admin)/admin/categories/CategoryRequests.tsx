'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { approveCategoryRequest, dismissCategoryRequest } from './actions'

export type CategoryRequest = {
  id: string
  proposed_name: string
  requested_by: string
  created_at: string
}

// Pending "Other" category requests from advertisers — approve (creates the
// category) or dismiss.
export function CategoryRequests({ requests }: { requests: CategoryRequest[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const run = (fn: (id: string) => Promise<{ error: string | null }>, id: string, ok: string) =>
    start(async () => {
      const res = await fn(id)
      if (res.error) toast.error(res.error)
      else {
        toast.success(ok)
        router.refresh()
      }
    })

  if (!requests.length) return null

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="border-b border-amber-500/20 px-4 py-2.5 text-sm font-medium">
        Pending category requests ({requests.length})
      </div>
      <ul className="divide-y divide-border">
        {requests.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{r.proposed_name}</div>
              <div className="text-xs text-muted-foreground">requested by {r.requested_by}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => run(approveCategoryRequest, r.id, `Added “${r.proposed_name}”`)}
              >
                <Check className="size-4" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => run(dismissCategoryRequest, r.id, 'Dismissed')}
              >
                <X className="size-4" /> Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
