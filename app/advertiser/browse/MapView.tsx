'use client'

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { BrowseVenue } from './BrowseClient'

// CircleMarkers (vector) avoid Leaflet's default-icon asset issues in bundlers.
export default function MapView({
  venues,
  center,
}: {
  venues: BrowseVenue[]
  center: [number, number]
}) {
  return (
    <MapContainer
      center={center}
      zoom={12}
      scrollWheelZoom
      className="h-[60vh] w-full overflow-hidden rounded-lg"
    >
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => {
          const color = v.open > 0 ? '#10b981' : '#ef4444'
          return (
            <CircleMarker
              key={v.id}
              center={[v.lat as number, v.lng as number]}
              radius={11}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.6, weight: 2 }}
            >
              <Popup>
                <strong>{v.name}</strong>
                <br />
                {v.category ?? v.venue_type ?? ''}
                <br />
                {v.foot_traffic_estimate.toLocaleString()} visits/mo
                <br />
                {v.open} of {v.capacity} slots open
              </Popup>
            </CircleMarker>
          )
        })}
    </MapContainer>
  )
}
