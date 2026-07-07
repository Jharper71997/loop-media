'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Client-side CSV export for admin tables — turns a serializable row set into a
// downloaded file, no server route needed. Column order follows the first row's
// keys.
export function ExportCsvButton({
  filename,
  rows,
  label = 'Export CSV',
}: {
  filename: string
  rows: Record<string, string | number>[]
  label?: string
}) {
  function download() {
    if (!rows.length) return
    const headers = Object.keys(rows[0])
    const escape = (v: string | number) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Button variant="outline" size="sm" disabled={rows.length === 0} onClick={download}>
      <Download className="size-4" /> {label}
    </Button>
  )
}
