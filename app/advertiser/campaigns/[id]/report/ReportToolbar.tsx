'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Link2, Printer, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Client controls for the report page: pick the month (navigates with ?month=),
// copy the public share link, and print / save as PDF. Hidden when printing.
export function ReportToolbar({
  months,
  month,
  shareUrl,
}: {
  months: { value: string; label: string }[]
  month: string
  shareUrl: string
}) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <select
        value={month}
        onChange={(e) => router.push(`?month=${e.target.value}`)}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
        aria-label="Report month"
      >
        {months.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? (
            <>
              <Check className="size-4" /> Copied
            </>
          ) : (
            <>
              <Link2 className="size-4" /> Copy share link
            </>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="size-4" /> Print / PDF
        </Button>
      </div>
    </div>
  )
}
