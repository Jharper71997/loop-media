'use client'

import { useEffect, useRef } from 'react'
import { GA_ID, trackScrollDepth } from '@/lib/gtag'

const THRESHOLDS = [25, 50, 75, 100] as const

// Fires scroll_depth once per milestone (25 / 50 / 75 / 100) as a visitor moves
// down a long page. `page` labels which page the milestone belongs to (e.g.
// 'marketing_home'). Mount it once near the top of a long server-rendered page:
//   <ScrollDepth page="marketing_home" />
// It renders nothing and only listens; a non-scrollable (short) page emits
// nothing, matching GA4's own enhanced-measurement behavior.
export function ScrollDepth({ page }: { page: string }) {
  const fired = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!GA_ID) return
    function check() {
      const doc = document.documentElement
      const scrollable = doc.scrollHeight - window.innerHeight
      if (scrollable <= 4) return // page fits the viewport — nothing to scroll
      const pct = Math.min(100, (window.scrollY / scrollable) * 100)
      for (const t of THRESHOLDS) {
        if (pct >= t && !fired.current.has(t)) {
          fired.current.add(t)
          trackScrollDepth({ percent: t, page })
        }
      }
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check, { passive: true })
    return () => {
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [page])

  return null
}
