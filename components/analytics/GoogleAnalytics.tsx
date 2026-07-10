'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { GA_ID, gaPageView } from '@/lib/gtag'

// Loads gtag.js and emits a page_view on every App Router navigation. Renders
// nothing when NEXT_PUBLIC_GA_ID is unset, so the site ships with analytics
// fully dormant until a measurement ID is provided — no behavior change, no
// network requests, no console noise.
export function GoogleAnalytics() {
  const pathname = usePathname()
  const bootstrapped = useRef(false)

  useEffect(() => {
    if (!GA_ID) return
    // Skip the first run: the initial page_view is sent once by the inline
    // config below, right after gtag loads. Every subsequent path change fires
    // a page_view here (config sets send_page_view:false so we own them all).
    if (!bootstrapped.current) {
      bootstrapped.current = true
      return
    }
    gaPageView(pathname)
  }, [pathname])

  if (!GA_ID) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}', { send_page_view: false });
          gtag('event', 'page_view', {
            page_path: location.pathname,
            page_location: location.href,
            page_title: document.title
          });
        `}
      </Script>
    </>
  )
}
