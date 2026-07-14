'use client'

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { MAP_TILE_URL, MAP_TILE_ATTRIBUTION } from '@/lib/mapTiles'
import { MapFitBounds } from '@/components/app/MapFitBounds'

export type DirectoryMapVenue = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  category: string | null
}

// Public locator map for the business directory. CircleMarkers (vector) sidestep
// Leaflet's default-icon asset issues in bundlers — same approach as the other maps.
export default function DirectoryMapView({
  venues,
  center,
}: {
  venues: DirectoryMapVenue[]
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
      className="h-[52vh] w-full overflow-hidden rounded-2xl"
    >
      <TileLayer attribution={MAP_TILE_ATTRIBUTION} url={MAP_TILE_URL} />
      <MapFitBounds points={points} />
      {venues
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => {
          const color = '#d4a333'
          return (
            <CircleMarker
              key={v.id}
              center={[v.lat as number, v.lng as number]}
              radius={11}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.7, weight: 2 }}
            >
              <Popup>
                <strong>{v.name}</strong>
                {v.category ? (
                  <>
                    <br />
                    {v.category}
                  </>
                ) : null}
              </Popup>
            </CircleMarker>
          )
        })}
    </MapContainer>
  )
}
