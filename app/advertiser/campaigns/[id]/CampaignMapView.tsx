'use client'

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_URL, MAP_TILE_ATTRIBUTION } from '@/lib/mapTiles'
import { formatNumber } from '@/lib/format'
import { MapFitBounds } from '@/components/app/MapFitBounds'

export type CampaignMapVenue = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  footTraffic: number
  scans: number
}

// CircleMarkers (vector) avoid Leaflet's default-icon asset issues in bundlers —
// same approach as the browse MapView.
export default function CampaignMapView({
  venues,
  center,
}: {
  venues: CampaignMapVenue[]
  center: [number, number]
}) {
  const points = venues
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => [v.lat as number, v.lng as number] as [number, number])
  return (
    <MapContainer
      center={center}
      zoom={12}
      scrollWheelZoom
      className="h-[50vh] w-full overflow-hidden rounded-lg"
    >
      <TileLayer
        attribution={MAP_TILE_ATTRIBUTION}
        url={MAP_TILE_URL}
      />
      <MapFitBounds points={points} />
      {venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => (
          <CircleMarker
            key={v.id}
            center={[v.lat as number, v.lng as number]}
            radius={11}
            pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.6, weight: 2 }}
          >
            <Popup>
              <strong>{v.name}</strong>
              <br />
              {formatNumber(v.scans)} QR scans (30d)
            </Popup>
          </CircleMarker>
        ))}
    </MapContainer>
  )
}
