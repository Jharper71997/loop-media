'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Periodically re-fetches the server component so live screen status stays
// fresh without a manual reload.
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000)
    return () => clearInterval(id)
  }, [router, seconds])
  return null
}
