'use client'

import dynamic from 'next/dynamic'
import type { DirectoryMapVenue } from './DirectoryMapView'

export type { DirectoryMapVenue } from './DirectoryMapView'

// Leaflet touches `window` at import time, so the map can't server-render.
// `ssr: false` is only allowed inside a client component — hence this wrapper.
const View = dynamic(() => import('./DirectoryMapView'), {
  ssr: false,
  loading: () => (
    <div className="grid h-[52vh] place-items-center rounded-2xl border border-border text-muted-foreground">
      Loading map…
    </div>
  ),
})

export default function DirectoryMap({
  venues,
  center,
}: {
  venues: DirectoryMapVenue[]
  center: [number, number]
}) {
  return <View venues={venues} center={center} />
}
