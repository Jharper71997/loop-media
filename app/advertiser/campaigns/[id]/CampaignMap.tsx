'use client'

import dynamic from 'next/dynamic'
import type { CampaignMapVenue } from './CampaignMapView'

// Leaflet touches `window` at import time, so the map must not server-render.
// `ssr: false` is only allowed inside a client component — hence this wrapper
// (same pattern as the browse view in app/advertiser/browse/BrowseClient.tsx).
const View = dynamic(() => import('./CampaignMapView'), {
  ssr: false,
  loading: () => (
    <div className="grid h-[50vh] place-items-center rounded-lg border border-border text-muted-foreground">
      Loading map…
    </div>
  ),
})

export default function CampaignMap({
  venues,
  center,
  showScans,
}: {
  venues: CampaignMapVenue[]
  center: [number, number]
  showScans?: boolean
}) {
  return <View venues={venues} center={center} showScans={showScans} />
}
