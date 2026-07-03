'use client'

import { useState, useTransition } from 'react'
import { Pencil, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { setAdQrTarget } from './actions'

// During review an admin can open the scan link (to test where it goes) and fix
// it in place before approving — a broken/wrong QR shouldn't reach a screen.
export function QrTargetEditor({
  adId,
  initialUrl,
}: {
  adId: string
  initialUrl: string | null
}) {
  const [url, setUrl] = useState(initialUrl ?? '')
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          className="h-8"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await setAdQrTarget(adId, url)
              if (res.error) {
                toast.error(res.error)
                return
              }
              toast.success('QR link updated')
              setEditing(false)
            })
          }
        >
          Save
        </Button>
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setUrl(initialUrl ?? '')
            setEditing(false)
          }}
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Scan destination
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3" /> Edit
        </button>
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-primary hover:underline"
          title="Open the scan destination in a new tab to review where it goes"
        >
          <ExternalLink className="size-3.5 shrink-0" />
          <span className="truncate">{url}</span>
        </a>
      ) : (
        <div className="rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-500">
          No scan link submitted — add one before approving
        </div>
      )}
    </div>
  )
}
