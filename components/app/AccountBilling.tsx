'use client'

import { useTransition } from 'react'
import { CreditCard, Infinity as InfinityIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatCents } from '@/lib/format'
import { UNLIMITED_CHANGES_CENTS } from '@/lib/fees'
import { openBillingPortal } from './account-actions'
import { startMembershipCheckout } from '@/app/advertiser/campaigns/[id]/actions'

// Billing controls for the Account tab: manage payment via the Stripe portal, and
// (for non-members) buy the unlimited-changes membership. Rendered by
// AccountScreen only when the caller passes billing info.
export function AccountBilling({
  returnPath,
  membershipBasePath,
  hasCustomer,
  pastDue,
  isMember,
}: {
  returnPath: string
  // Passed through to startMembershipCheckout so post-checkout returns to the
  // right shell ('/advertiser' or '/host/advertise').
  membershipBasePath: '/advertiser' | '/host/advertise'
  hasCustomer: boolean
  pastDue: boolean
  isMember: boolean
}) {
  const [billingPending, startBilling] = useTransition()
  const [memberPending, startMember] = useTransition()

  function manageBilling() {
    startBilling(async () => {
      const res = await openBillingPortal(returnPath)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.url) window.location.assign(res.url)
    })
  }

  function buyMembership() {
    startMember(async () => {
      const res = await startMembershipCheckout(membershipBasePath)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.checkoutUrl) window.location.assign(res.checkoutUrl)
    })
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="text-sm font-medium">Billing</p>
          <p className="text-xs text-muted-foreground">
            {pastDue
              ? 'Your last payment didn’t go through — update your card to keep your ads running.'
              : 'Update your payment method, view invoices, or cancel.'}
          </p>
        </div>

        {pastDue && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Payment past due. Update your card to resume your campaigns automatically.
          </div>
        )}

        <Button
          type="button"
          variant={pastDue ? 'default' : 'outline'}
          className="w-full"
          disabled={billingPending || !hasCustomer}
          onClick={manageBilling}
        >
          <CreditCard className="size-4" />
          {billingPending ? 'Opening…' : 'Manage billing'}
        </Button>
        {!hasCustomer && (
          <p className="text-xs text-muted-foreground">
            Billing management appears once your first campaign is paid.
          </p>
        )}

        {isMember ? (
          <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <InfinityIcon className="size-4 shrink-0 text-primary" />
            <span className="font-medium">Unlimited ad changes active</span>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={memberPending}
            onClick={buyMembership}
          >
            <InfinityIcon className="size-4" />
            {memberPending
              ? 'Working…'
              : `Get unlimited changes · ${formatCents(UNLIMITED_CHANGES_CENTS)}/mo`}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
