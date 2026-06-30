'use client'

import { useTransition } from 'react'
import { Infinity as InfinityIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { formatCents } from '@/lib/format'
import { UNLIMITED_CHANGES_CENTS, AD_CHANGE_FEE_CENTS } from '@/lib/fees'
import { useBasePath } from '@/lib/useBasePath'
import { startMembershipCheckout } from './actions'

// Upsell shown to non-members: swap the per-change fee for an unlimited-changes
// membership. Sends them to a subscription Checkout; the webhook activates it.
export function MembershipUpsell() {
  const [pending, start] = useTransition()
  const base = useBasePath()

  function buy() {
    start(async () => {
      const res = await startMembershipCheckout(base)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.checkoutUrl) window.location.assign(res.checkoutUrl)
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-start gap-2 text-sm">
        <InfinityIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <p className="font-medium">Change your ad as often as you like</p>
          <p className="text-xs text-muted-foreground">
            Skip the {formatCents(AD_CHANGE_FEE_CENTS)} per change. Unlimited changes for{' '}
            {formatCents(UNLIMITED_CHANGES_CENTS)}/mo.
          </p>
        </div>
      </div>
      <Button size="sm" variant="outline" disabled={pending} onClick={buy}>
        {pending ? 'Working…' : 'Get unlimited changes'}
      </Button>
    </div>
  )
}
