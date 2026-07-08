'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Pause, Play, Trash2, Archive, Plus, CreditCard, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useBasePath, homeFor } from '@/lib/useBasePath'
import { cn } from '@/lib/utils'
import { pauseCampaign, resumeCampaign, trashCampaign, archiveCampaign, resumeCheckout, relaunchCampaign } from './actions'

export function CampaignControls({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const base = useBasePath()
  const home = homeFor(base)
  // Hosts have no "Past campaigns" page; send them home (their dashboard).
  const pastHref = base === '/host/advertise' ? '/host' : '/advertiser/past'
  const [pending, start] = useTransition()
  // Which destructive confirmation is open (routine actions run without one).
  const [dialog, setDialog] = useState<null | 'archive' | 'delete'>(null)

  const run = (fn: (id: string) => Promise<{ error: string | null }>, ok: string, to?: string) =>
    start(async () => {
      const res = await fn(id)
      if (res.error) toast.error(res.error)
      else {
        toast.success(ok)
        if (to) router.push(to)
        else router.refresh()
      }
    })

  // Draft = created but never paid for. Re-open Stripe so they can finish without
  // rebuilding (the campaign + venues are already saved).
  const resume = () =>
    start(async () => {
      const res = await resumeCheckout(id, base)
      if (res.error) toast.error(res.error)
      else if (res.checkoutUrl) window.location.href = res.checkoutUrl
    })

  // Canceled/restored campaign: the old subscription is dead, so going live again
  // means a fresh payment. Send them to Checkout (or relaunch free in demo mode).
  const relaunch = () =>
    start(async () => {
      const res = await relaunchCampaign(id, base)
      if (res.error) toast.error(res.error)
      else if (res.checkoutUrl) window.location.href = res.checkoutUrl
      else if (res.demo) {
        toast.success('Campaign relaunched (demo mode — no payment).')
        router.refresh()
      }
    })

  const confirmArchive = () =>
    start(async () => {
      const res = await archiveCampaign(id)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Moved to Past campaigns')
      setDialog(null)
      router.push(pastHref)
    })

  const confirmDelete = () =>
    start(async () => {
      const res = await trashCampaign(id)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Moved to Trash')
      setDialog(null)
      router.push(home)
    })

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* Primary actions — the routine, non-destructive ones. */}
        {status === 'draft' && (
          <Button disabled={pending} onClick={resume}>
            <CreditCard className="size-4" /> Resume payment
          </Button>
        )}
        {status === 'canceled' && (
          <Button disabled={pending} onClick={relaunch}>
            <CreditCard className="size-4" /> Relaunch & pay
          </Button>
        )}
        {/* Add more screens to this live campaign (prorated) — base-aware so it
            works in both the advertiser and host advertise trees. */}
        {status === 'active' && (
          <Link href={`${base}/campaigns/${id}/add`} className={cn(buttonVariants(), 'gap-1.5')}>
            <Plus className="size-4" /> Add screens
          </Link>
        )}
        {status === 'paused' && (
          <Button disabled={pending} onClick={() => run(resumeCampaign, 'Campaign resumed')}>
            <Play className="size-4" /> Resume
          </Button>
        )}
        {status === 'active' && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(pauseCampaign, 'Campaign paused')}
          >
            <Pause className="size-4" /> Pause
          </Button>
        )}

        {/* Destructive actions live behind an overflow menu so they aren't a
            mis-tap away from Pause/Add screens. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="More actions" disabled={pending} />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            {status !== 'canceled' && (
              <DropdownMenuItem onClick={() => setDialog('archive')}>
                <Archive className="size-4" /> Archive
              </DropdownMenuItem>
            )}
            {status !== 'canceled' && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onClick={() => setDialog('delete')}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={dialog === 'archive'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End this campaign?</DialogTitle>
            <DialogDescription>
              It stops running and moves to Past campaigns, but stays saved with its performance.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={confirmArchive}>
              {pending ? 'Working…' : 'Archive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move this campaign to Trash?</DialogTitle>
            <DialogDescription>
              Your ad stops running. It stays saved and you can restore it anytime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" disabled={pending} onClick={confirmDelete}>
              {pending ? 'Working…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
