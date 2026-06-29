'use client'

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_URL, MAP_TILE_ATTRIBUTION } from '@/lib/mapTiles'
import { MapFitBounds } from '@/components/app/MapFitBounds'

export type AdsMapVenue = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  // The advertiser's ads currently placed at this venue.
  ads: { title: string; live: boolean }[]
}

// Where the advertiser's ads physically are. Green pin = at least one ad live
// here, gray = placed but paused. CircleMarkers (vector) sidestep Leaflet's
// default-icon asset issues in bundlers — same approach as the other maps.
export default function AdsMapView({
  venues,
  center,
}: {
  venues: AdsMapVenue[]
  center: [number, number]
}) {
  const points = venues
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => [v.lat as number, v.lng as number] as [number, number])
  return (
    <MapContainer
      center={center}
      zoom={12}
      scrollWheelZoom={false}
      className="h-[44vh] w-full overflow-hidden rounded-2xl"
    >
      <TileLayer
        attribution={MAP_TILE_ATTRIBUTION}
        url={MAP_TILE_URL}
      />
      <MapFitBounds points={points} />
      {venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => {
          const live = v.ads.some((a) => a.live)
          const color = live ? '#10b981' : '#9ca3af'
          return (
            <CircleMarker
              key={v.id}
              center={[v.lat as number, v.lng as number]}
              radius={12}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.6, weight: 2 }}
            >
              <Popup>
                <strong>{v.name}</strong>
                <br />
                {v.ads.map((a, i) => (
                  <span key={i}>
                    {a.live ? '🟢' : '⚪️'} {a.title}
                    <br />
                  </span>
                ))}
              </Popup>
            </CircleMarker>
          )
        })}
    </MapContainer>
  )
}
