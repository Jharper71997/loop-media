'use client'

import { usePathname } from 'next/navigation'

// The advertise buy flow runs under two URL trees: /advertiser (pure advertisers)
// and /host/advertise (a host advertising on the network from inside their own
// app). The flow's client components share one codebase, so they derive their
// link prefix from the current path instead of hardcoding /advertiser — that's
// what keeps a host from being bounced out of the host side mid-flow.
export type AdvertiseBase = '/advertiser' | '/host/advertise'

export function useBasePath(): AdvertiseBase {
  const pathname = usePathname()
  return pathname.startsWith('/host/advertise') ? '/host/advertise' : '/advertiser'
}

// The "home" a back-link / post-action redirect should return to for each tree:
// the host's venue dashboard, or the advertiser campaigns dashboard.
export function homeFor(base: AdvertiseBase): string {
  return base === '/host/advertise' ? '/host' : '/advertiser'
}
