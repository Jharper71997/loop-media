'use client'

import { useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'
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
    <div className="flex items-center justify-between gap-2 text-xs">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-primary hover:underline"
          title="Open the scan destination in a new tab"
        >
          QR → {url}
        </a>
      ) : (
        <span className="text-muted-foreground">No scan link set</span>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        <Pencil className="size-3" /> Edit
      </button>
    </div>
  )
}
