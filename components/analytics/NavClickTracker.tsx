'use client'

import { useEffect } from 'react'
import { GA_ID, trackNavClick } from '@/lib/gtag'

// One delegated listener that turns clicks on links inside any [data-ga-nav]
// region (tab bars, sidebars, header/footer nav) into navigation_click events.
//
// Delegation is deliberate: it covers server-rendered nav (the marketing page)
// as well as client nav, and no individual <Link> has to be wrapped — a nav just
// tags its container with data-ga-nav="<region>". Only real anchors fire, so
// sign-out buttons, sheet triggers, and territory selects are naturally ignored.
// The listener is passive: it never calls preventDefault, so navigation is
// unchanged whether or not gtag is loaded.
export function NavClickTracker() {
  useEffect(() => {
    if (!GA_ID) return
    function onClick(e: MouseEvent) {
      const target = e.target as Element | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const region = anchor.closest('[data-ga-nav]') as HTMLElement | null
      if (!region) return
      trackNavClick({
        linkText:
          (anchor.textContent ?? '').trim() ||
          anchor.getAttribute('aria-label') ||
          anchor.href,
        linkUrl: anchor.getAttribute('href') ?? anchor.href,
        navRegion: region.dataset.gaNav ?? 'unknown',
      })
    }
    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [])
  return null
}
