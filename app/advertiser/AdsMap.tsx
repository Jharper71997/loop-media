'use client'

import dynamic from 'next/dynamic'
import type { AdsMapVenue } from './AdsMapView'

export type { AdsMapVenue } from './AdsMapView'

// Leaflet touches `window` at import time, so the map can't server-render.
// `ssr: false` is only allowed inside a client component — hence this wrapper.
const View = dynamic(() => import('./AdsMapView'), {
  ssr: false,
  loading: () => (
    <div className="grid h-[44vh] place-items-center rounded-2xl border border-border text-muted-foreground">
      Loading map…
    </div>
  ),
})

export default function AdsMap({
  venues,
  center,
}: {
  venues: AdsMapVenue[]
  center: [number, number]
}) {
  return <View venues={venues} center={center} />
}
