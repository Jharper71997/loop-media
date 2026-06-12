'use client'

import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { US_CENTER, US_ZOOM } from '@/lib/geo'

// Frames the map to whatever venues exist: fits their bounds (so venues spread
// across the country zoom out to a national view), or falls back to a US-wide
// view when there are none. Drop this inside a <MapContainer> instead of hard-
// coding center/zoom. Points are [lat, lng].
export function MapFitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  // Stable dependency without depending on array identity each render.
  const key = points.map((p) => p.join(',')).join('|')

  useEffect(() => {
    if (!points.length) {
      map.setView(US_CENTER, US_ZOOM)
      return
    }
    if (points.length === 1) {
      map.setView(points[0], 14)
      return
    }
    map.fitBounds(points, { padding: [40, 40], maxZoom: 15 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map])

  return null
}
