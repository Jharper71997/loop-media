'use client'

import { useTransition } from 'react'
import { BarChart3 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { formatCents } from '@/lib/format'
import { INSIGHTS_CENTS } from '@/lib/fees'
import { useBasePath } from '@/lib/useBasePath'
import { startInsightsCheckout } from '@/app/advertiser/campaigns/[id]/actions'

// Buy-Insights CTA shown wherever QR scans are gated. Sends the advertiser to a
// subscription Checkout; the webhook activates the membership and every scan
// number unlocks across the dashboard, results, and the monthly report.
//   full    — a bordered card with copy + button (replaces a locked scan panel)
//   compact — just the button (sits under a locked tile / in a header)
export function InsightsUpsell({ compact = false }: { compact?: boolean }) {
  const [pending, start] = useTransition()
  const base = useBasePath()

  function buy() {
    start(async () => {
      const res = await startInsightsCheckout(base)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.checkoutUrl) window.location.assign(res.checkoutUrl)
    })
  }

  const label = pending ? 'Working…' : `Unlock Insights — ${formatCents(INSIGHTS_CENTS)}/mo`

  if (compact) {
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={buy}>
        {label}
      </Button>
    )
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 text-center">
      <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-primary/10">
        <BarChart3 className="size-5 text-primary" />
      </div>
      <p className="text-sm font-semibold">Loop Insights</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        See every scan your ads drive, by day and by location, so you know exactly which screens
        bring people in.
      </p>
      <Button className="mt-4" size="sm" disabled={pending} onClick={buy}>
        {label}
      </Button>
    </div>
  )
}
