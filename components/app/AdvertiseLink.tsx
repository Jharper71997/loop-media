'use client'

import Link from 'next/link'
import { useBasePath } from '@/lib/useBasePath'

// A link inside the advertise tree that stays in whichever tree it's rendered
// under — /advertiser for pure advertisers, /host/advertise for a host buying
// screens from inside their own app. Pass the suffix ('/calendar'), not the full
// path, so neither shell can bounce the user out of the other.
export function AdvertiseLink({
  to,
  className,
  children,
}: {
  to: string
  className?: string
  children: React.ReactNode
}) {
  const base = useBasePath()
  return (
    <Link href={`${base}${to}`} className={className}>
      {children}
    </Link>
  )
}
