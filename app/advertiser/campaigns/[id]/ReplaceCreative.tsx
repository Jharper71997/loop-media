'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCents } from '@/lib/format'
import { AD_CHANGE_FEE_CENTS, AD_CHANGE_NOTICE_DAYS } from '@/lib/fees'
import { replaceCreative } from './actions'

// Lets an advertiser swap the creative on an existing campaign. Uploads the new
// file to the `creatives` bucket (same path convention as the first upload in the
// new-campaign wizard), then calls replaceCreative. Members change free; everyone
// else is sent to a $10 Checkout and the change applies once paid. Either way the
// ad goes back to review, so the old spot keeps playing until the new one is
// approved.
export function ReplaceCreative({
  campaignId,
  userId,
  isMember,
}: {
  campaignId: string
  userId: string
  isMember: boolean
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    if (!file) return toast.error('Choose an image or video first.')
    start(async () => {
      const supabase = createClient()
      const ext = file.name.split('.').pop() ?? 'bin'
      const path = `${userId}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('creatives').upload(path, file)
      if (upErr) {
        toast.error(`Upload failed: ${upErr.message}`)
        return
      }
      const url = supabase.storage.from('creatives').getPublicUrl(path).data.publicUrl
      const type = file.type.startsWith('video') ? 'video' : 'image'
      const res = await replaceCreative(campaignId, url, type)
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (res.checkoutUrl) {
        window.location.assign(res.checkoutUrl)
        return
      }
      toast.success('New creative submitted for review.')
      setFile(null)
      setOpen(false)
      router.refresh()
    })
  }

  const feeLabel = isMember ? 'Free with your membership' : `${formatCents(AD_CHANGE_FEE_CENTS)} per change`
  const submitLabel = pending
    ? 'Working…'
    : isMember
      ? 'Submit for review'
      : `Pay ${formatCents(AD_CHANGE_FEE_CENTS)} and submit`

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <RefreshCw className="size-4" /> Replace creative
      </Button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Upload a new creative</p>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            setOpen(false)
            setFile(null)
          }}
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Image ads look best at 1180 x 820. Your new spot goes to review, then replaces the current
        one on your screens. Your placements and billing stay as they are. We ask for{' '}
        {AD_CHANGE_NOTICE_DAYS} days notice on changes.
      </p>
      <Input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        className="h-10"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {file && (
        <p className="text-xs text-muted-foreground">
          {file.name} · {(file.size / 1_000_000).toFixed(1)} MB
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" disabled={pending || !file} onClick={submit}>
          <Upload className="size-4" /> {submitLabel}
        </Button>
        <span className="text-xs text-muted-foreground">{feeLabel}</span>
      </div>
    </div>
  )
}
