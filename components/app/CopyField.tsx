'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { trackCopy } from '@/lib/gtag'

// Small monospace value + copy button. Used for things a provisioner copies onto
// a Pi (kiosk URL, WiFi). `display` lets a long value show compactly while the
// full `value` is what gets copied. `context` only labels the copy_to_clipboard
// analytics event (e.g. 'screen_pairing') — it never affects what is copied.
export function CopyField({
  value,
  display,
  label = 'Copy',
  context = 'code_sample',
}: {
  value: string
  display?: string
  label?: string
  context?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="max-w-full break-all rounded bg-muted px-2 py-1 font-mono text-xs">
        {display ?? value}
      </code>
      <button
        type="button"
        onClick={() =>
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true)
            trackCopy({ label, context })
            setTimeout(() => setCopied(false), 1500)
          })
        }
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? 'Copied' : label}
      </button>
    </div>
  )
}
