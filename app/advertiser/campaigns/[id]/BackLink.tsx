'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useBasePath, homeFor } from '@/lib/useBasePath'

// Back link on the campaign detail page. Returns to the right "home" for the
// tree it's viewed under: the host's venue dashboard or the advertiser's
// campaigns dashboard.
export function BackLink() {
  const base = useBasePath()
  const home = homeFor(base)
  return (
    <Link
      href={home}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> {home === '/host' ? 'Back to dashboard' : 'All campaigns'}
    </Link>
  )
}
