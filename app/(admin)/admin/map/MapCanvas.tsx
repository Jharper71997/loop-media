'use client'

import Link from 'next/link'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_ATTRIBUTION } from '@/lib/mapTiles'
import { useMapTileUrl } from '@/components/app/useMapTiles'
import { US_CENTER, US_ZOOM } from '@/lib/geo'
import { MapFitBounds } from '@/components/app/MapFitBounds'

export type VenuePin = {
  id: string
  name: string
  category: string | null
  lat: number | null
  lng: number | null
  footTraffic: number
  medianDailyCustomers: number | null
  screensTotal: number
  online: number
  offline: number
  unpaired: number
  capacity: number
  used: number
  pending?: boolean
}

// Vector CircleMarkers (avoids Leaflet's default-icon bundler issues). When a
// coverage advertiser is selected, covered venues glow gold and the rest dim;
// otherwise venues are colored by aggregate screen status.
export function MapCanvas({
  venues,
  highlightIds,
}: {
  venues: VenuePin[]
  highlightIds: string[] | null
}) {
  const tileUrl = useMapTileUrl()
  const highlight = highlightIds ? new Set(highlightIds) : null
  const geo = venues.filter((v) => v.lat != null && v.lng != null)
  const points = geo.map((v) => [v.lat as number, v.lng as number] as [number, number])

  return (
    <MapContainer
      center={US_CENTER}
      zoom={US_ZOOM}
      scrollWheelZoom
      className="h-[70vh] w-full overflow-hidden rounded-lg"
    >
      <TileLayer
        attribution={MAP_TILE_ATTRIBUTION}
        url={tileUrl}
      />
      <MapFitBounds points={points} />
      {geo.map((v) => {
          // Pending (unverified) venues show as a dashed gold ring so a newly
          // added location is visible before it's activated.
          const statusColor =
            v.online > 0 ? '#10b981' : v.offline > 0 ? '#ef4444' : '#71717a'
          let color = v.pending ? '#d4a333' : statusColor
          let opacity = v.pending ? 0.15 : 0.6
          if (highlight) {
            if (highlight.has(v.id)) color = '#d4a333'
            else {
              color = '#52525b'
              opacity = 0.25
            }
          }
          const fill = v.capacity > 0 ? v.used / v.capacity : 0
          const radius = 8 + Math.round(fill * 10)
          return (
            <CircleMarker
              key={v.id}
              center={[v.lat as number, v.lng as number]}
              radius={radius}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: opacity,
                weight: 2,
                dashArray: v.pending ? '4 3' : undefined,
              }}
            >
              <Popup>
                <strong>{v.name}</strong>
                {v.pending && <span className="text-primary"> · pending</span>}
                <br />
                {v.category ?? '—'}
                <br />
                {v.medianDailyCustomers && v.medianDailyCustomers > 0
                  ? `${v.medianDailyCustomers.toLocaleString()} customers/day`
                  : v.footTraffic > 0
                    ? `${v.footTraffic.toLocaleString()} visits/mo`
                    : 'Traffic not set'}
                <br />
                {v.used}/{v.capacity} slots filled · {v.screensTotal} screen
                {v.screensTotal === 1 ? '' : 's'}
                <br />
                <span className="text-success">{v.online} online</span>
                {' · '}
                <span className="text-destructive">{v.offline} offline</span>
                {' · '}
                {v.unpaired} unpaired
                <br />
                <Link href={`/admin/venues`}>Venues</Link>
              </Popup>
            </CircleMarker>
          )
        })}
    </MapContainer>
  )
}
