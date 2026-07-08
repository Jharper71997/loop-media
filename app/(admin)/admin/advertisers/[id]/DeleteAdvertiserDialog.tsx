'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deleteAdvertiser } from './actions'

// Permanent, billing-canceling delete → gated behind typing the advertiser's exact
// email so it can't be fat-fingered. On success the account is gone and the email
// is free to sign up again (as an advertiser or a host), so we leave the now-dead
// detail page for the advertiser list.
export function DeleteAdvertiserDialog({
  id,
  name,
  email,
}: {
  id: string
  name: string | null
  email: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [pending, start] = useTransition()

  const matches = confirm.trim().toLowerCase() === email.trim().toLowerCase()

  function remove() {
    if (!matches) return
    start(async () => {
      const res = await deleteAdvertiser(id)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Advertiser deleted')
      setOpen(false)
      router.push('/admin/advertisers')
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setConfirm('')
      }}
    >
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="text-destructive hover:text-destructive" />}
      >
        <Trash2 className="size-4" /> Delete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name ?? email}?</DialogTitle>
          <DialogDescription>This can’t be undone.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Deleting this advertiser permanently:</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>removes their account, campaigns, ads, and any ads running on screens</li>
            <li>cancels their Stripe billing</li>
            <li>frees their email so they can sign up again as an advertiser or a host</li>
          </ul>
          <p className="text-muted-foreground">
            Any venue they host stays on the network (it just loses its host link).
          </p>

          <div className="space-y-1.5 pt-1">
            <Label className="text-xs text-muted-foreground">
              Type <span className="font-mono text-foreground">{email}</span> to confirm
            </Label>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder={email}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={remove} disabled={!matches || pending}>
            {pending ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
