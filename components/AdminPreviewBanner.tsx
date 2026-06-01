import Link from 'next/link'
import { ArrowLeft, Eye } from 'lucide-react'

// Shown at the top of the advertiser/host apps when the viewer is actually an
// admin previewing that surface (so it's obvious, with a one-click way back).
export function AdminPreviewBanner({ surface }: { surface: 'advertiser' | 'host' }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
      <span className="flex items-center gap-1.5">
        <Eye className="size-3.5" />
        Admin preview — you&apos;re viewing the {surface} experience.
      </span>
      <Link href="/admin" className="flex items-center gap-1 font-medium hover:underline">
        <ArrowLeft className="size-3.5" /> Back to admin
      </Link>
    </div>
  )
}
