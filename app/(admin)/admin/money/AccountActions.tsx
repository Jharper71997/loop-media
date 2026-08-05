'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { formatCents } from '@/lib/format'
import type { BillingMethod } from '@/lib/billing'
import { recordPayment, setCompUntil, linkStripeSubscription } from './actions'

const iso = (d: string) => new Date(`${d}T12:00:00Z`).toISOString()
const day = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

// The three things you do to an account that doesn't bill itself: log the check
// that arrived, move a comp's end date, or point it at a Stripe subscription
// that lives on another account.
export function AccountActions({
  campaignId,
  advertiserName,
  monthlyCents,
  method,
  paidThrough,
}: {
  campaignId: string
  advertiserName: string
  monthlyCents: number
  method: BillingMethod
  paidThrough: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()

  const [amount, setAmount] = useState((monthlyCents / 100).toFixed(2))
  const [paidAt, setPaidAt] = useState(day())
  // Default the next chase date to a month past whatever they're covered to, or
  // a month from today for an account that has never paid.
  const [through, setThrough] = useState(
    paidThrough && new Date(paidThrough) > new Date()
      ? new Date(new Date(paidThrough).getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
      : day(30)
  )
  const [compDate, setCompDate] = useState(day(30))
  const [subId, setSubId] = useState('')

  const done = (msg: string) => (res: { error: string | null }) => {
    if (res.error) toast.error(res.error)
    else {
      toast.success(msg)
      setOpen(false)
      router.refresh()
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Billing</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{advertiserName}</DialogTitle>
          <DialogDescription>
            {formatCents(monthlyCents)}/mo ·{' '}
            {paidThrough
              ? `covered through ${new Date(paidThrough).toLocaleDateString()}`
              : 'never billed'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ---- Record a payment ---- */}
          <section className="space-y-3">
            <p className="text-sm font-medium">Record a payment</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Amount</Label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Paid on</Label>
                <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Through</Label>
                <Input type="date" value={through} onChange={(e) => setThrough(e.target.value)} />
              </div>
            </div>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () =>
                  done('Payment recorded.')(
                    await recordPayment({
                      campaignId,
                      amountCents: Math.round(
                        parseFloat(amount.replace(/[^0-9.]/g, '') || '0') * 100
                      ),
                      paidAt: iso(paidAt),
                      paidThrough: iso(through),
                    })
                  )
                )
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Record {formatCents(Math.round(parseFloat(amount.replace(/[^0-9.]/g, '') || '0') * 100))}
            </Button>
            {method === 'comp' && (
              <p className="text-xs text-muted-foreground">
                Recording a payment ends the comp, so their ad stops coming down on the comp date.
              </p>
            )}
          </section>

          {/* ---- Comp ---- */}
          <section className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Run it free until</p>
            <div className="flex gap-2">
              <Input
                type="date"
                value={compDate}
                onChange={(e) => setCompDate(e.target.value)}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () =>
                    done('Comp updated.')(await setCompUntil(campaignId, iso(compDate)))
                  )
                }
              >
                Comp
              </Button>
              {method === 'comp' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    start(async () => done('Comp removed.')(await setCompUntil(campaignId, null)))
                  }
                >
                  End
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The nightly job pulls the ad off screens on this date by itself.
            </p>
          </section>

          {/* ---- Stripe elsewhere ---- */}
          <section className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Billed on another Stripe account</p>
            <div className="flex gap-2">
              <Input
                value={subId}
                onChange={(e) => setSubId(e.target.value)}
                placeholder="sub_1Abc…"
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !subId.trim()}
                onClick={() =>
                  start(async () =>
                    done('Subscription linked.')(
                      await linkStripeSubscription(campaignId, subId, iso(through))
                    )
                  )
                }
              >
                Link
              </Button>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
